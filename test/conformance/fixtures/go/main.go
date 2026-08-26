package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime/debug"
	"syscall"
	"time"

	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	fixtureID       = "go-sdk"
	sdkModule       = "github.com/modelcontextprotocol/go-sdk"
	expectedVersion = "v1.7.0"
	toolName        = "fixture_echo"
)

type echoInput struct {
	Marker string `json:"marker" jsonschema:"synthetic marker"`
}

type echoOutput struct {
	Receipt string `json:"receipt" jsonschema:"synthetic receipt"`
}

type facts struct {
	FixtureID           string   `json:"fixtureId"`
	Version             string   `json:"version,omitempty"`
	Roles               []string `json:"roles,omitempty"`
	Transports          []string `json:"transports,omitempty"`
	UnsupportedProfiles []string `json:"unsupportedProfiles,omitempty"`
	Transport           string   `json:"transport,omitempty"`
	NegotiatedRevision  string   `json:"negotiatedRevision,omitempty"`
	Operations          []string `json:"operations,omitempty"`
	Initialized         bool     `json:"initialized,omitempty"`
	Ping                bool     `json:"ping,omitempty"`
	ToolsCount          int      `json:"toolsCount,omitempty"`
	CallError           bool     `json:"callError,omitempty"`
	Ready               bool     `json:"ready,omitempty"`
	Endpoint            string   `json:"endpoint,omitempty"`
	ErrorCode           string   `json:"errorCode,omitempty"`
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		_ = emit(facts{FixtureID: fixtureID, ErrorCode: classifyError(err)})
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 1 && args[0] == "--self-check" {
		version, err := linkedSDKVersion()
		if err != nil {
			return err
		}
		return emit(facts{
			FixtureID:           fixtureID,
			Version:             version,
			Roles:               []string{"client", "server"},
			Transports:          []string{"stdio", "streamable-http"},
			UnsupportedProfiles: []string{"retained-http-sse", "protocol-2024-10-07"},
		})
	}
	if len(args) == 0 {
		return errors.New("usage")
	}
	switch args[0] {
	case "server":
		return runServer(args[1:])
	case "probe":
		return runProbe(args[1:])
	default:
		return errors.New("usage")
	}
}

func linkedSDKVersion() (string, error) {
	build, ok := debug.ReadBuildInfo()
	if !ok {
		return "", errors.New("build-info-unavailable")
	}
	for _, dependency := range build.Deps {
		if dependency.Path == sdkModule {
			version := dependency.Version
			if dependency.Replace != nil {
				version = dependency.Replace.Version
			}
			if version != expectedVersion {
				return "", errors.New("sdk-version-mismatch")
			}
			return version, nil
		}
	}
	return "", errors.New("sdk-not-linked")
}

func newMCPServer() *mcp.Server {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	server := mcp.NewServer(
		&mcp.Implementation{Name: "one-mcp-go-conformance-fixture", Version: "1"},
		&mcp.ServerOptions{Logger: logger},
	)
	server.AddReceivingMiddleware(func(next mcp.MethodHandler) mcp.MethodHandler {
		return func(ctx context.Context, method string, request mcp.Request) (mcp.Result, error) {
			if method == "server/discover" {
				return nil, &jsonrpc.Error{Code: jsonrpc.CodeMethodNotFound, Message: "Method not found"}
			}
			return next(ctx, method, request)
		}
	})
	mcp.AddTool(server, &mcp.Tool{Name: toolName, Description: "Return a synthetic receipt"},
		func(_ context.Context, _ *mcp.CallToolRequest, _ echoInput) (*mcp.CallToolResult, echoOutput, error) {
			return nil, echoOutput{Receipt: "synthetic-private-result"}, nil
		})
	return server
}

func runServer(args []string) error {
	flags := flag.NewFlagSet("server", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	transport := flags.String("transport", "stdio", "transport")
	if err := flags.Parse(args); err != nil {
		return errors.New("invalid-arguments")
	}
	switch *transport {
	case "stdio":
		return newMCPServer().Run(context.Background(), &mcp.StdioTransport{})
	case "streamable-http":
		return serveHTTP()
	default:
		return errors.New("unsupported-transport")
	}
}

func serveHTTP() error {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return errors.New("listen-failed")
	}
	defer listener.Close()
	mux := http.NewServeMux()
	server := newMCPServer()
	mux.Handle("/mcp", mcp.NewStreamableHTTPHandler(
		func(*http.Request) *mcp.Server { return server },
		&mcp.StreamableHTTPOptions{JSONResponse: true, Stateless: false},
	))
	mux.HandleFunc("/health", func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"ready":true}`))
	})
	httpServer := &http.Server{Handler: mux, ReadHeaderTimeout: 2 * time.Second}
	serverErrors := make(chan error, 1)
	go func() { serverErrors <- httpServer.Serve(listener) }()
	endpoint := "http://" + listener.Addr().String() + "/mcp"
	if err := emit(facts{FixtureID: fixtureID, Transport: "streamable-http", Ready: true, Endpoint: endpoint}); err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	select {
	case err := <-serverErrors:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return errors.New("http-server-failed")
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			return errors.New("http-shutdown-failed")
		}
		return nil
	}
}

func runProbe(args []string) error {
	flags := flag.NewFlagSet("probe", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	transportName := flags.String("transport", "", "transport")
	endpoint := flags.String("endpoint", "", "streamable HTTP endpoint")
	commandJSON := flags.String("command-json", "", "stdio command as a JSON string array")
	if err := flags.Parse(args); err != nil {
		return errors.New("invalid-arguments")
	}
	var transport mcp.Transport
	switch *transportName {
	case "stdio":
		var command []string
		if err := json.Unmarshal([]byte(*commandJSON), &command); err != nil || len(command) == 0 {
			return errors.New("invalid-command")
		}
		transport = &mcp.CommandTransport{
			Command:           isolatedCommand(command),
			TerminateDuration: 2 * time.Second,
		}
	case "streamable-http":
		if *endpoint == "" {
			return errors.New("missing-endpoint")
		}
		transport = &mcp.StreamableClientTransport{
			Endpoint: *endpoint, HTTPClient: &http.Client{Transport: &http.Transport{}},
			DisableStandaloneSSE: true, MaxRetries: -1,
		}
	default:
		return errors.New("unsupported-transport")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client := mcp.NewClient(
		&mcp.Implementation{Name: "one-mcp-go-conformance-probe", Version: "1"},
		&mcp.ClientOptions{Logger: slog.New(slog.NewTextHandler(io.Discard, nil))},
	)
	session, err := client.Connect(ctx, transport, nil)
	if err != nil {
		return errors.New("initialize-failed")
	}
	closed := false
	defer func() {
		if !closed {
			_ = session.Close()
		}
	}()
	if err := session.Ping(ctx, nil); err != nil {
		return errors.New("ping-failed")
	}
	tools, err := session.ListTools(ctx, nil)
	if err != nil {
		return errors.New("tools-list-failed")
	}
	result, err := session.CallTool(ctx, &mcp.CallToolParams{
		Name: toolName, Arguments: map[string]any{"marker": "synthetic-private-argument"},
	})
	if err != nil {
		return errors.New("tools-call-failed")
	}
	negotiated := session.InitializeResult()
	if negotiated == nil {
		return errors.New("initialize-failed")
	}
	connectionOperation := "initialize"
	if negotiated.ProtocolVersion >= "2026-07-28" {
		connectionOperation = "server/discover"
	}
	if err := session.Close(); err != nil {
		return errors.New("teardown-failed")
	}
	closed = true
	return emit(facts{
		FixtureID: fixtureID, Transport: *transportName, Initialized: true, Ping: true,
		NegotiatedRevision: negotiated.ProtocolVersion,
		Operations:         []string{connectionOperation, "ping", "tools/list", "tools/call"},
		ToolsCount:         len(tools.Tools), CallError: result.IsError,
	})
}

func isolatedCommand(command []string) *exec.Cmd {
	cmd := exec.Command(command[0], command[1:]...)
	cmd.Env = []string{}
	return cmd
}

func emit(value facts) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	return encoder.Encode(value)
}

func classifyError(err error) string {
	code := err.Error()
	switch code {
	case "usage", "invalid-arguments", "invalid-command", "unsupported-transport", "missing-endpoint",
		"build-info-unavailable", "sdk-version-mismatch", "sdk-not-linked", "listen-failed",
		"http-server-failed", "http-shutdown-failed", "initialize-failed", "ping-failed",
		"tools-list-failed", "tools-call-failed", "teardown-failed":
		return code
	default:
		return "fixture-failed"
	}
}
