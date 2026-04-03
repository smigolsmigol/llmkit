FROM gcr.io/oss-fuzz-base/base-builder-python

COPY . $SRC/llmkit
WORKDIR $SRC/llmkit

COPY .clusterfuzzlite/build.sh $SRC/build.sh
