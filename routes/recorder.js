const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const platform = os.platform(); // 'win32', 'linux', 'darwin'
const room = process.argv[2];

if (!room) {
  console.error('❌ Room name is required!');
  console.log('Usage: node recorder.js <room-name>');
  process.exit(1);
}

const recordingsDir = path.join(__dirname, '../routes/recordings');
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
  console.log('📂 Recordings folder created.');
}

const output = path.join(recordingsDir, `${room}.mp4`);
console.log(`🎥 Started recording room: ${room}`);
console.log(`FFmpeg path: ${ffmpegPath}`);
console.log(`📁 Recordings directory: ${recordingsDir}`);
console.log(`🎯 Output file: ${output}`);

let ffmpegArgs;

if (platform === 'win32') {
  ffmpegArgs = [
    '-y',
    '-f', 'gdigrab',
    '-framerate', '30',
    '-i', 'desktop',
    '-f', 'dshow',
    '-i', 'audio=Internal Microphone (Cirrus Logic Superior High Definition Audio)', // Change if needed
    '-vcodec', 'libx264',
    '-acodec', 'aac',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    output
  ];
} else if (platform === 'linux') {
  ffmpegArgs = [
    '-y',
    '-f', 'x11grab',
    '-framerate', '30',
    '-video_size', '1280x720',
    '-i', ':99.0', // Virtual display (xvfb)
    '-vcodec', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    output
  ];
} else if (platform === 'darwin') {
  ffmpegArgs = [
    '-y',
    '-f', 'avfoundation',
    '-framerate', '30',
    '-i', '1:0', // You may need to adjust input index
    '-vcodec', 'libx264',
    '-acodec', 'aac',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    output
  ];
} else {
  console.error(`❌ Unsupported platform: ${platform}`);
  process.exit(1);
}

console.log('🎬 Starting screen recording...');
const ffmpeg = spawn(ffmpegPath, ffmpegArgs);

ffmpeg.stderr.on('data', data => {
  console.log(`📺 FFmpeg: ${data}`);
});

ffmpeg.on('close', code => {
  console.log(`✅ FFmpeg exited with code ${code}`);

  if (fs.existsSync(output)) {
    const stats = fs.statSync(output);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    if (stats.size > 0) {
      console.log(`🎉 Recording successful!`);
      console.log(`📁 File: ${output}`);
      console.log(`📏 Size: ${sizeMB} MB`);
    } else {
      console.warn('⚠️ File was created but is empty.');
    }
  } else {
    console.error('❌ File was not created.');
  }
});

process.on('SIGINT', () => {
  console.log('🛑 Stopping recording...');
  ffmpeg.kill('SIGTERM');
});
