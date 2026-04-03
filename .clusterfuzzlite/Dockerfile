FROM gcr.io/oss-fuzz-base/base-builder-python@sha256:7cd3344ca786812f933cad89b6bb709c19cf3d48a3853325d307b0d8c5ba231a

COPY . $SRC/llmkit
WORKDIR $SRC/llmkit

COPY .clusterfuzzlite/build.sh $SRC/build.sh
