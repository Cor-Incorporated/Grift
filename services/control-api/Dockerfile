FROM golang:1.24-alpine AS builder

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /control-api ./cmd/server

FROM gcr.io/distroless/static

COPY --from=builder /control-api /control-api
COPY --from=builder /build/migrations /migrations

EXPOSE 8080

ENTRYPOINT ["/control-api"]
