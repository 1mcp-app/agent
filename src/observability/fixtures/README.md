# Telemetry TLS test fixtures

These certificates and deliberately public private keys are test data only. They authenticate a loopback test Collector and must never be trusted or used outside tests. The CA private key is not retained. The server certificate covers localhost and 127.0.0.1; the separate client certificate exercises mTLS. No global trust store is changed.
