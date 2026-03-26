const fs = require("fs")

// Create minimal valid PNG files (1x1 teal pixel, browsers will scale)
// These are base64 encoded minimal PNGs
const png192 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
)

fs.writeFileSync("public/icon-192.png", png192)
fs.writeFileSync("public/icon-512.png", png192)
console.log("PNG icons created")
