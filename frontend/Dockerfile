FROM node:alpine
WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application source code
COPY . .

# Expose port 5173 for Vite dev server
EXPOSE 5173

# Run Vite dev server with host flag to expose it outside the container
CMD ["npm", "run", "dev", "--", "--host"]
