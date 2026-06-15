# Build stage
FROM golang:alpine AS builder
WORKDIR /app

# Copy dependency configs
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build statically linked binary
RUN CGO_ENABLED=0 GOOS=linux go build -o main .

# Run stage
FROM alpine:latest
WORKDIR /app

# Copy binary from build stage
COPY --from=builder /app/main .

# Expose port 3001
EXPOSE 3001

CMD ["./main"]
