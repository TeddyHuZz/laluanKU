FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# Copy the shaded OTP jar
COPY otp-2.6.0-shaded.jar .

# Copy the graph configs and data
COPY graphs/ ./graphs/

# Expose port 8080 for the routing engine API
EXPOSE 8080

# Load the pre-built graph
CMD ["java", "-Xmx4G", "-jar", "otp-2.6.0-shaded.jar", "--load", "graphs/malaysia"]
