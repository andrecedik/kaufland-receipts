"""Tests for the `serve` CLI command (see CONTEXT.md's Web Upload)."""

from typer.testing import CliRunner

from kaufland_receipts.cli import app

runner = CliRunner()


def test_serve_builds_the_app_and_calls_uvicorn(tmp_path, monkeypatch):
    captured = {}

    def fake_run(fastapi_app, host, port):
        captured["app"] = fastapi_app
        captured["host"] = host
        captured["port"] = port

    monkeypatch.setattr("kaufland_receipts.cli.uvicorn.run", fake_run)
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))

    result = runner.invoke(
        app,
        [
            "serve",
            "--web-dir", str(tmp_path / "web"),
            "--host", "0.0.0.0",
            "--port", "9000",
        ],
    )

    assert result.exit_code == 0, result.output
    assert captured["host"] == "0.0.0.0"
    assert captured["port"] == 9000
    assert captured["app"] is not None
