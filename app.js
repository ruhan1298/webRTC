const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const session = require('express-session');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { Op } = require('sequelize');

// Sequelize Models
const sequelize = require('./model/index');
const User = require('./model/user');
const CallLog = require('./model/calllog');

// Sync database tables
CallLog.sync({ alter: true });

// Routes
const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');
const roomRouter = require('./routes/room');

const app = express();
const server = http.createServer(app);

// Socket.IO setup with proper CORS
const io = new Server(server, {
  cors: {
    origin: "*", // For development - restrict this in production
    methods: ["GET", "POST"],
    credentials: false
  },
  allowEIO3: true, // Allow Engine.IO v3 clients
  transports: ['websocket', 'polling'] // Enable both transports
});

// View Engine Setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

// Middlewares
app.use(logger('dev'));
app.use(cors({
  origin: "*", // For development - restrict this in production
  credentials: false
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/room', roomRouter);

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // User registration
  socket.on("register", (userId) => {
    socket.userId = userId;
    socket.join(userId.toString());
    console.log(`User ${userId} registered and joined room ${userId}`);
  });

  // Call initiation
  socket.on('call:initiated', async ({ callerId, receiverId, callType }) => {
    try {
      console.log('Call initiated:', { callerId, receiverId, callType });
      
      const receiverSockets = await io.in(receiverId.toString()).fetchSockets();
      const receiverBusy = receiverSockets.some(s => s.isBusy);

      if (receiverBusy) {
        const call = await CallLog.create({
          callerId,
          receiverId,
          callType,
          status: 'busy',
          startedAt: new Date(),
          endedAt: new Date()
        });
        io.to(callerId.toString()).emit('call:busy', { 
          message: 'User is busy', 
          callId: call.id 
        });
        return;
      }
      
      const call = await CallLog.create({
        callerId,
        receiverId,
        callType,
        status: 'attempted',
        startedAt: new Date(),
      });

      socket.callId = call.id;
      socket.isBusy = true;
      
      io.to(receiverId.toString()).emit('call:incoming', {
        callerId,
        callType,
        callId: call.id
      });
      
      console.log('Call incoming event sent to receiver:', receiverId);
    } catch (err) {
      console.error('Call initiation error:', err);
      socket.emit('error', { message: 'Failed to initiate call' });
    }
  });

  // Call acceptance
  socket.on('call:accepted', async ({ callId }) => {
    try {
      console.log('Call accepted:', callId);
      
      await CallLog.update(
        { status: 'connected' },
        { where: { id: callId } }
      );

      const call = await CallLog.findByPk(callId);
      if (call) {
        const callerSockets = await io.in(call.callerId.toString()).fetchSockets();
        const receiverSockets = await io.in(call.receiverId.toString()).fetchSockets();
        
        callerSockets.forEach(s => s.isBusy = true);
        receiverSockets.forEach(s => s.isBusy = true);

        io.to(call.callerId.toString()).emit('call:accepted', { callId });
        io.to(call.receiverId.toString()).emit('call:accepted', { callId });
      }
    } catch (err) {
      console.error('Call acceptance error:', err);
    }
  });

  // WebRTC signaling messages
  socket.on("webrtc:offer", ({ to, offer }) => {
    console.log('WebRTC offer from', socket.id, 'to', to);
    io.to(to.toString()).emit("webrtc:offer", { from: socket.id, offer });
  });

  socket.on("webrtc:answer", ({ to, answer }) => {
    console.log('WebRTC answer from', socket.id, 'to', to);
    io.to(to.toString()).emit("webrtc:answer", { from: socket.id, answer });
  });

  socket.on("webrtc:ice-candidate", ({ to, candidate }) => {
    io.to(to.toString()).emit("webrtc:ice-candidate", { from: socket.id, candidate });
  });

  // Call rejection
  socket.on("call:rejected", async ({ callId }) => {
    try {
      console.log('Call rejected:', callId);
      
      const call = await CallLog.findByPk(callId);
      if (call) {
        await call.update({ status: "rejected", endedAt: new Date() });
        io.to(call.callerId.toString()).emit("call:rejected", { callId });
        
        // Clear busy status
        const callerSockets = await io.in(call.callerId.toString()).fetchSockets();
        callerSockets.forEach(s => s.isBusy = false);
      }
    } catch (err) {
      console.error("Call rejection error:", err);
    }
  });

  // Call cancellation
  socket.on("call:cancelled", async ({ callId }) => {
    try {
      console.log('Call cancelled:', callId);
      
      const call = await CallLog.findByPk(callId);
      if (call) {
        await call.update({ status: "cancelled", endedAt: new Date() });
        io.to(call.receiverId.toString()).emit("call:cancelled", { callId });
        
        // Clear busy status
        const callerSockets = await io.in(call.callerId.toString()).fetchSockets();
        callerSockets.forEach(s => s.isBusy = false);
      }
    } catch (err) {
      console.error("Call cancel error:", err);
    }
  });

  // Call timeout
  socket.on("call:timeout", async ({ callId }) => {
    try {
      console.log('Call timeout:', callId);
      
      const call = await CallLog.findByPk(callId);
      if (call) {
        await call.update({ status: "missed", endedAt: new Date() });
        io.to(call.receiverId.toString()).emit("call:missed", { callerId: call.callerId });
        io.to(call.callerId.toString()).emit("call:noAnswer", { message: "No response from user" });
        
        // Clear busy status
        const callerSockets = await io.in(call.callerId.toString()).fetchSockets();
        const receiverSockets = await io.in(call.receiverId.toString()).fetchSockets();
        callerSockets.forEach(s => s.isBusy = false);
        receiverSockets.forEach(s => s.isBusy = false);
      }
    } catch (err) {
      console.error("Call timeout error:", err);
    }
  });

  // Call ending
  socket.on('call:ended', async ({ callId }) => {
    try {
      console.log('Call ended:', callId);
      
      const call = await CallLog.findByPk(callId);
      if (call) {
        const duration = Math.floor((new Date() - new Date(call.startedAt)) / 1000);
        
        await call.update({
          status: 'completed',
          endedAt: new Date(),
        });

        const callerSockets = await io.in(call.callerId.toString()).fetchSockets();
        const receiverSockets = await io.in(call.receiverId.toString()).fetchSockets();
        callerSockets.forEach(s => s.isBusy = false);
        receiverSockets.forEach(s => s.isBusy = false);

        io.to(call.callerId.toString()).emit('call:ended', { 
          callId, 
          duration, 
          status: 'completed' 
        });
        io.to(call.receiverId.toString()).emit('call:ended', { 
          callId, 
          duration, 
          status: 'completed' 
        });
      }
    } catch (err) {
      console.error('Call ended error:', err);
    }
  });

  // User disconnection
  socket.on("disconnect", async () => {
    console.log("User disconnected:", socket.id);
    
    if (socket.callId) {
      try {
        const call = await CallLog.findByPk(socket.callId);
        if (call && ['attempted', 'connected'].includes(call.status)) {
          await call.update({ status: "disconnected", endedAt: new Date() });
          
          // Notify the other party
          const otherUserId = call.callerId === socket.userId ? call.receiverId : call.callerId;
          io.to(otherUserId.toString()).emit("call:ended", { 
            callId: call.id, 
            status: "disconnected" 
          });
        }
      } catch (err) {
        console.error("Disconnect cleanup error:", err);
      }
    }
  });
});

// API Routes


// 404 handler
app.use((req, res, next) => {
  next(createError(404));
});

// Error handler
app.use((err, req, res, next) => {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  res.status(err.status || 500);
  res.render('error');
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Socket.IO server ready`);
});

module.exports = app;