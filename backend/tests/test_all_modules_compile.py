"""Her uygulama modülü derlenir: tembel (işlev içinde) import edilen bir dosyadaki sözdizimi hatası testlerde görünmez ama canlıda ilk çağrıda çöker (attributes.py, 2026-10-26)."""
import pathlib
import py_compile

import pytest

APP = pathlib.Path(__file__).resolve().parents[1] / "app"


@pytest.mark.parametrize("path", sorted(APP.rglob("*.py")), ids=lambda p: str(p.relative_to(APP)))
def test_module_compiles(path):
    py_compile.compile(str(path), doraise=True)
