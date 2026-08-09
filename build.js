const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = __dirname;
const dist = path.join(root, "dist");

function copyFile(file) {
  const source = path.join(root, file);
  const destination = path.join(dist, file);

  if (fs.existsSync(source)) {
    fs.copyFileSync(source, destination);
    console.log(`Copied: ${file}`);
  } else {
    console.warn(`Warning: ${file} not found`);
  }
}

function copyDirectory(directory) {
  const source = path.join(root, directory);
  const destination = path.join(dist, directory);

  if (fs.existsSync(source)) {
    fs.cpSync(source, destination, { recursive: true });
    console.log(`Copied directory: ${directory}`);
  } else {
    console.warn(`Warning: ${directory}/ not found`);
  }
}

// Remove old dist folder
if (fs.existsSync(dist)) {
  fs.rmSync(dist, { recursive: true, force: true });
}

// Create fresh dist folder
fs.mkdirSync(dist, { recursive: true });

// Copy application files
[
  "index.html",
  "app.js",
  "manifest.json",
  "sw.js",
  "privacy.html",
  "icon-192.png",
  "icon-512.png"
].forEach(copyFile);

// Copy screenshots
copyDirectory("screenshots");

// Build Tailwind CSS
console.log("Building Tailwind CSS...");

execSync(
  "npx tailwindcss -i ./src/input.css -o ./dist/output.css --minify",
  {
    cwd: root,
    stdio: "inherit"
  }
);

console.log("Build completed successfully.");