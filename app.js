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
// User.sync({ alter: true });

const CallLog = require('./model/calllog');
CallLog.sync({ alter: true });

// Routes
const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');
const roomRouter = require('./routes/room');
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// View Engine Setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

// Middlewares
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/room', roomRouter);

// Sync DB Models
const callog = require('./model/calllog');
// callog.sync({force:true})
const room = require('./model/room');
// room.sync({force:true})
// Removed duplicate declaration of io

const user = require('./model/user');
// user.sync({force:true})
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // User registration to their personal room (userId)
  socket.on("register", (userId) => {
    socket.join(userId.toString());
    socket.userId = userId; // Store userId in socket for reference
    console.log(`User ${userId} registered and joined room ${userId}`);
  });

  // Chat message handler - FIXED
// IMPROVED: Chat message handler with better error handling
socket.on("chat:message", async ({ to, message, from }) => {
  try {
    console.log(`💬 Chat message from ${from} to ${to}: ${message}`);
    
    // Check if receiver is online
    const receiverSockets = await io.in(to.toString()).fetchSockets();
    
    if (receiverSockets.length === 0) {
      console.log(`❌ Receiver ${to} is offline`);
      // Send delivery status back to sender
      socket.emit("chat:delivery-failed", {
        to: to,
        message: "User is offline",
        originalMessage: message
      });
      return;
    }
    
    // Send message to receiver's room
    io.to(to.toString()).emit("chat:message", {
      from: from,
      message: message,
      timestamp: new Date().toISOString()
    });
    
    console.log(`✅ Message sent to room: ${to}`);
    
    // Send delivery confirmation to sender
    socket.emit("chat:message-sent", {
      to: to,
      message: message,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`❌ Chat message error:`, error);
    socket.emit("chat:delivery-failed", {
      to: to,
      message: "Message delivery failed",
      originalMessage: message
    });
  }
});

  // Media state handler
  socket.on("media-state", ({ to, video, audio }) => {
    console.log(`Media state from socket ${socket.id} to user ${to}: video=${video}, audio=${audio}`);
    io.to(to.toString()).emit("media-state", {
      from: socket.id,
      video: video,
      audio: audio
    });
    console.log(`Media state sent to room: ${to}`);
  });

  // Call initiation
  socket.on('call:initiated', async ({ callerId, receiverId, callType }) => {
    try {
      const receiverSockets = await io.in(receiverId.toString()).fetchSockets();

      if (receiverSockets.length === 0) {
        // Receiver offline
        console.log(`Receiver ${receiverId} is offline`);
        socket.emit('call:busy', { message: 'User is offline' });
        return;
      }

      // Check if receiver is busy
      const receiverBusy = receiverSockets.some(s => s.isBusy);
      if (receiverBusy) {
        console.log(`Receiver ${receiverId} is busy`);
        socket.emit('call:busy', { message: 'User is busy' });
        return;
      }

      // Generate unique call ID
      const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      socket.callId = callId;

      // Mark caller as busy
      socket.isBusy = true;

      // Notify receiver
      io.to(receiverId.toString()).emit("call:incoming", {
        callerId,
        callType,
        callId: callId,
        socketId: socket.id
      });

      console.log(`Call initiated from ${callerId} to ${receiverId}, callId: ${callId}`);

    } catch (err) {
      console.error('Call initiation error:', err);
    }
  });

  // Call acceptance
  socket.on('call:accepted', ({ callId }) => {
    try {
      console.log(`Call ${callId} accepted`);
      
      // Mark receiver as busy
      socket.isBusy = true;
      socket.callId = callId;

      // Find caller socket and notify
      const allSockets = io.sockets.sockets;
      for (let [socketId, sock] of allSockets) {
        if (sock.callId === callId && sock.id !== socket.id) {
          sock.emit('call:accepted', { callId });
          console.log(`Notified caller ${sock.id} that call was accepted`);
          break;
        }
      }

    } catch (err) {
      console.error('Call acceptance error:', err);
    }
  });

  // WebRTC signaling handlers
  socket.on("offer", ({ offer, to }) => {
    console.log(`Relaying offer from ${socket.id} to user ${to}`);
    io.to(to.toString()).emit("offer", { from: socket.userId || socket.id, offer });
  });

  socket.on("answer", ({ answer, to }) => {
    console.log(`Relaying answer from ${socket.id} to user ${to}`);
    io.to(to.toString()).emit("answer", { from: socket.userId || socket.id, answer });
  });

  socket.on("ice-candidate", ({ candidate, to }) => {
    console.log(`Relaying ICE candidate from ${socket.id} to user ${to}`);
    io.to(to.toString()).emit("ice-candidate", { from: socket.userId || socket.id, candidate });
  });

  // Call rejection
  socket.on("call:rejected", ({ callId }) => {
    try {
      console.log(`Call ${callId} rejected`);
      
      // Find caller socket and notify
      const allSockets = io.sockets.sockets;
      for (let [socketId, sock] of allSockets) {
        if (sock.callId === callId && sock.id !== socket.id) {
          sock.emit('call:rejected', { callId });
          sock.isBusy = false;
          sock.callId = null;
          console.log(`Notified caller ${sock.id} that call was rejected`);
          break;
        }
      }
      
      // Reset receiver state
      socket.isBusy = false;
      socket.callId = null;

    } catch (err) {
      console.error("Call rejection error:", err);
    }
  });

  // Call cancellation
  socket.on("call:cancelled", ({ callId }) => {
    try {
      console.log(`Call ${callId} cancelled`);
      
      // Find receiver socket and notify
      const allSockets = io.sockets.sockets;
      for (let [socketId, sock] of allSockets) {
        if (sock.callId === callId && sock.id !== socket.id) {
          sock.emit('call:cancelled', { callId });
          console.log(`Notified receiver ${sock.id} that call was cancelled`);
          break;
        }
      }
      
      // Reset caller state
      socket.isBusy = false;
      socket.callId = null;

    } catch (err) {
      console.error("Call cancel error:", err);
    }
  });

  // Call ended
  socket.on('call:ended', ({ callId }) => {
    try {
      console.log(`Call ${callId} ended`);
      
      // Find other participant and notify
      const allSockets = io.sockets.sockets;
      for (let [socketId, sock] of allSockets) {
        if (sock.callId === callId && sock.id !== socket.id) {
          sock.emit('call:ended', { callId, duration: 0, status: 'completed' });
          sock.isBusy = false;
          sock.callId = null;
          console.log(`Notified participant ${sock.id} that call ended`);
          break;
        }
      }
      
      // Reset current socket state
      socket.isBusy = false;
      socket.callId = null;

    } catch (err) {
      console.error('Call ended error:', err);
    }
  });

  // User disconnect cleanup
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    
    // If user was in a call, notify the other participant
    if (socket.callId) {
      const allSockets = io.sockets.sockets;
      for (let [socketId, sock] of allSockets) {
        if (sock.callId === socket.callId && sock.id !== socket.id) {
          sock.emit('call:ended', { 
            callId: socket.callId, 
            duration: 0,
            status: 'disconnected' 
          });
          sock.isBusy = false;
          sock.callId = null;
          console.log(`Notified participant ${sock.id} about disconnection`);
          break;
        }
      }
    }
    
    // Reset socket state
    socket.isBusy = false;
    socket.callId = null;
  });
});

// ===================== ROUTES ===================== //
// app.get('/calls/:userId', async (req, res) => {
//   try {
//     const { userId } = req.params;

//     const calls = await CallLog.findAll({
//       where: {
//         [Op.or]: [
//           { callerId: userId },
//           { receiverId: userId }
//         ]
//       },
//       order: [['startedAt', 'DESC']]
//     });

//     res.json(calls);
//   } catch (err) {
//     console.error('Error fetching call logs:', err);
//     res.status(500).json({ error: 'Internal Server Error' });
//   }
// });

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
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});


module.exports = app;