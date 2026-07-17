#!/bin/bash -eux

python3 -m pip install --require-hashes --only-binary=:all: \
  --requirement "$SRC/llmkit/.clusterfuzzlite/requirements.txt"

export PYTHONPATH="$SRC/llmkit/packages/python-sdk/src${PYTHONPATH:+:$PYTHONPATH}"
cd "$SRC/llmkit/packages/python-sdk"

for fuzzer in "$SRC"/llmkit/packages/python-sdk/fuzz/fuzz_*.py; do
  compile_python_fuzzer "$fuzzer"
done
