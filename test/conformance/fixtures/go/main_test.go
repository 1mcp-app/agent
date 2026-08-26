package main

import (
	"encoding/json"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

type fixtureFacts struct {
	FixtureID          string   `json:"fixtureId"`
	Version            string   `json:"version"`
	Roles              []string `json:"roles"`
	Transport          string   `json:"transport"`
	NegotiatedRevision string   `json:"negotiatedRevision"`
	Operations         []string `json:"operations"`
	Initialized        bool     `json:"initialized"`
	Ping               bool     `json:"ping"`
	ToolsCount         int      `json:"toolsCount"`
	CallError          bool     `json:"callError"`
	Ready              bool     `json:"ready"`
	Endpoint           string   `json:"endpoint"`
}

func runDriver(t *testing.T, args ...string) fixtureFacts {
	t.Helper()
	binary := filepath.Join(t.TempDir(), "go-fixture")
	if output, err := exec.Command("go", "build", "-mod=vendor", "-o", binary, ".").CombinedOutput(); err != nil {
		t.Fatalf("build fixture: %v\n%s", err, output)
	}
	output, err := exec.Command(binary, args...).Output()
	if err != nil {
		t.Fatalf("run fixture: %v", err)
	}
	var facts fixtureFacts
	if err := json.Unmarshal(output, &facts); err != nil {
		t.Fatalf("decode structural facts: %v", err)
	}
	return facts
}

func TestSelfCheckUsesLinkedSDKVersion(t *testing.T) {
	facts := runDriver(t, "--self-check")
	if facts.FixtureID != "go-sdk" || facts.Version != "v1.7.0" {
		t.Fatalf("unexpected self-check facts: %#v", facts)
	}
	if len(facts.Roles) != 2 || facts.Roles[0] != "client" || facts.Roles[1] != "server" {
		t.Fatalf("unexpected roles: %#v", facts.Roles)
	}
}

func TestStdioProbeExercisesProtocolWithoutPayloadOutput(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "go-fixture")
	if output, err := exec.Command("go", "build", "-mod=vendor", "-o", binary, ".").CombinedOutput(); err != nil {
		t.Fatalf("build fixture: %v\n%s", err, output)
	}
	command, err := json.Marshal([]string{binary, "server", "--transport", "stdio"})
	if err != nil {
		t.Fatal(err)
	}
	output, err := exec.Command(binary, "probe", "--transport", "stdio", "--command-json", string(command)).Output()
	if err != nil {
		t.Fatalf("probe fixture: %v", err)
	}
	if string(output) == "" || containsForbiddenPayload(string(output)) {
		t.Fatalf("probe output contains payload data: %s", output)
	}
	var facts fixtureFacts
	if err := json.Unmarshal(output, &facts); err != nil {
		t.Fatal(err)
	}
	if !facts.Initialized || !facts.Ping || facts.ToolsCount != 1 || facts.CallError {
		t.Fatalf("unexpected probe facts: %#v", facts)
	}
	if facts.NegotiatedRevision != "2025-11-25" || len(facts.Operations) != 4 || facts.Operations[0] != "initialize" {
		t.Fatalf("missing negotiation facts: %#v", facts)
	}
}

func TestStreamableHTTPProbeAndOwnedTeardown(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "go-fixture")
	if output, err := exec.Command("go", "build", "-mod=vendor", "-o", binary, ".").CombinedOutput(); err != nil {
		t.Fatalf("build fixture: %v\n%s", err, output)
	}
	server := exec.Command(binary, "server", "--transport", "streamable-http")
	stdout, err := server.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := server.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Process.Kill() })
	var ready fixtureFacts
	if err := json.NewDecoder(stdout).Decode(&ready); err != nil {
		t.Fatalf("decode readiness: %v", err)
	}
	if !ready.Ready || ready.Endpoint == "" {
		t.Fatalf("unexpected readiness facts: %#v", ready)
	}
	output, err := exec.Command(binary, "probe", "--transport", "streamable-http", "--endpoint", ready.Endpoint).Output()
	if err != nil {
		t.Fatalf("probe fixture: %v", err)
	}
	var probe fixtureFacts
	if err := json.Unmarshal(output, &probe); err != nil {
		t.Fatal(err)
	}
	if containsForbiddenPayload(string(output)) {
		t.Fatalf("probe output contains payload data: %s", output)
	}
	if probe.Transport != "streamable-http" || probe.ToolsCount != 1 || probe.NegotiatedRevision != "2025-11-25" || probe.Operations[0] != "initialize" {
		t.Fatalf("unexpected probe facts: %#v", probe)
	}
	if err := server.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- server.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("server teardown: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("server did not terminate")
	}
}

func TestInvalidProbeOutputIsStructural(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "go-fixture")
	if output, err := exec.Command("go", "build", "-mod=vendor", "-o", binary, ".").CombinedOutput(); err != nil {
		t.Fatalf("build fixture: %v\n%s", err, output)
	}
	secret := "synthetic-private-argument"
	output, err := exec.Command(binary, "probe", "--transport", "stdio", "--command-json", secret).Output()
	if err == nil {
		t.Fatal("invalid probe unexpectedly succeeded")
	}
	if containsForbiddenPayload(string(output)) {
		t.Fatalf("error output contains supplied value: %s", output)
	}
	var response map[string]any
	if err := json.Unmarshal(output, &response); err != nil {
		t.Fatalf("error output is not structural JSON: %v", err)
	}
}

func containsForbiddenPayload(output string) bool {
	for _, forbidden := range []string{"synthetic-private-argument", "synthetic-private-result"} {
		if len(output) >= len(forbidden) {
			for i := 0; i <= len(output)-len(forbidden); i++ {
				if output[i:i+len(forbidden)] == forbidden {
					return true
				}
			}
		}
	}
	return false
}
