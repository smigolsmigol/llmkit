FROM gcr.io/oss-fuzz-base/base-builder-python

RUN pip3 install atheris httpx openai

COPY . $SRC/llmkit
WORKDIR $SRC/llmkit

COPY .clusterfuzzlite/build.sh $SRC/build.sh
