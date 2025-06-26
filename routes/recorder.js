const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
console.log(`FFmpeg path: ${ffmpegPath}`);


// 🧠 Room name from command-line args
const room = process.argv[2];

if (!room) {
  console.error('❌ Room name is required!');
  console.log('Usage: node recorder.js <room-name>');
  process.exit(1);
}

// 📁 Define output folder
const recordingsDir = path.join(__dirname, '../routes/recordings');
console.log(`📁 Recordings directory: ${recordingsDir}`);

// 📂 Create recordings directory if not exists
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
  console.log('📂 Recordings folder created.');
}

// 🎯 Define output file path
const output = path.join(recordingsDir, `${room}.mp4`);
console.log(`🎯 Output file: ${output}`);

// 🎬 FFmpeg arguments
const ffmpegArgs = [
  '-y',
  '-f', 'gdigrab',
  '-framerate', '30',
  '-i', 'desktop',
  '-f', 'dshow',
  '-i', 'audio=Internal Microphone (Cirrus Logic Superior High Definition Audio)', // OR use AirPods
  '-t', '10',
  '-vcodec', 'libx264',
  '-acodec', 'aac',
  '-preset', 'ultrafast',
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  output
];


// 🚀 Start recording
console.log('🎬 Starting screen recording...');
const ffmpeg = spawn(ffmpegPath, ffmpegArgs);

// 🔍 Log FFmpeg output
ffmpeg.stderr.on('data', (data) => {
  console.log(`📺 FFmpeg: ${data}`);
});

// ✅ Handle process completion
ffmpeg.on('close', (code) => {
  console.log(`✅ FFmpeg exited with code ${code}`);

  if (fs.existsSync(output)) {
    const stats = fs.statSync(output);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

    if (stats.size > 0) {
      console.log(`🎉 Recording successful!`);
      console.log(`📁 File: ${output}`);
      console.log(`📏 Size: ${sizeMB} MB`);
    } else {
      console.warn('⚠️ Warning: File was created but is empty.');
    }
  } else {
    console.error('❌ Error: File was not created.');
  }
});

// 🛑 Graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Stopping recording...');
  ffmpeg.kill('SIGTERM');
});
