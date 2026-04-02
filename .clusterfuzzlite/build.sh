#!/bin/bash -eu

cd $SRC/llmkit/packages/python-sdk
pip3 install .
pip3 install atheris

for fuzzer in $(find $SRC/llmkit/packages/python-sdk/fuzz -name 'fuzz_*.py'); do
  compile_python_fuzzer "$fuzzer"
done
