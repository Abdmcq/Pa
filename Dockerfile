# Use an official Node.js runtime as a parent image.
# Using version 18 as it's a stable LTS release.
FROM node:18-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Install ffmpeg, which is required by the fluent-ffmpeg library for audio processing.
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json (if available) to leverage Docker cache.
COPY package*.json ./

# Install application dependencies.
RUN npm install --production

# Bundle the application source code inside the Docker image.
COPY . .

# Your app listens on a port, let's expose it. Render will use this.
# The express server in the code uses process.env.PORT || 3000.
EXPOSE 3000

# Define the command to run the application.
# We will set the BOT_TOKEN as an environment variable in the Render dashboard.
CMD [ "node", "bot.js" ]

