def test_the_serve_entry_point_does_not_import_the_service_at_the_top_level() -> None:
    import subprocess
    import sys

    code = "import sys, ats.serve; print('ats.service' in sys.modules, 'fastapi' in sys.modules)"
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)
    assert out.stdout.strip() == "False False"
