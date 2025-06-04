const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const session = require('express-session');
const http = require('http');
const cors = require('cors');
var passport=require('passport')
const flash = require('express-flash');

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

app.use(session({
  secret: 'secret',
  resave: false,
  saveUninitialized: true,
}));
require('./middleware/passport')(passport)

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());
app.use((req, res, next) => {
  res.locals.success_msg = req.flash("success_msg");
  res.locals.error_msg = req.flash("error_msg");
  res.locals.error = req.flash("error");
console.log(req.user)
  res.locals.user = req.user;
  
  next();
});



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
// Store room information
const rooms = new Map();
const users = new Map();

// Utility functions
function getRoomParticipants(roomId) {
  const room = rooms.get(roomId);
  return room ? Array.from(room.participants.values()) : [];
}

function findUserBySocketId(socketId) {
  for (let [userId, userInfo] of users.entries()) {
    if (userInfo.socketId === socketId) {
      return userInfo;
    }
  }
  return null;
}

function findSocketByUserId(userId) {
  const user = users.get(userId);
  if (user) {
    return io.sockets.sockets.get(user.socketId);
  }
  return null;
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("🔌 User connected:", socket.id);

  // Direct user registration (for 1-to-1 calls)
  socket.on("register", ({ userId }) => {
    try {
      console.log(`📝 Registration attempt: ${userId}`);
      
      // Check if user already exists
      if (users.has(userId)) {
        socket.emit("registration:failed", { 
          message: "User ID already taken" 
        });
        return;
      }

      // Register user
      socket.join(userId.toString());
      socket.userId = userId;
      
      users.set(userId, {
        userId: userId,
        socketId: socket.id,
        status: 'online',
        isBusy: false,
        callId: null
      });

      socket.emit("registered", { userId, socketId: socket.id });
      console.log(`✅ User ${userId} registered`);
      
    } catch (error) {
      console.error("❌ Registration error:", error);
      socket.emit("registration:failed", { 
        message: "Registration failed" 
      });
    }
  });

  // Room functionality
  socket.on("join-room", ({ roomId, userName }) => {
    try {
      console.log(`🏠 User ${userName} joining room: ${roomId}`);
      
      // Create room if it doesn't exist
      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          id: roomId,
          participants: new Map(),
          createdAt: new Date(),
          callActive: false
        });
        console.log(`📝 Created new room: ${roomId}`);
      }

      const room = rooms.get(roomId);
      
      // Add participant to room
      const participant = {
        socketId: socket.id,
        userName: userName,
        joinedAt: new Date(),
        isReady: false
      };
      
      room.participants.set(socket.id, participant);
      socket.join(roomId);
      socket.roomId = roomId;
      socket.userName = userName;

      // Get current participants list
      const participants = getRoomParticipants(roomId);
      
      // Notify user they joined
      socket.emit("room-joined", { 
        roomId, 
        participants 
      });

      // Notify other participants
      socket.to(roomId).emit("participant-joined", { 
        participant, 
        participants 
      });

      console.log(`✅ ${userName} joined room ${roomId}. Total: ${participants.length}`);
      
    } catch (error) {
      console.error("❌ Room join error:", error);
      socket.emit("room-join-failed", { 
        message: "Failed to join room" 
      });
    }
  });

  // Room call functionality
  socket.on("room-ready-for-call", ({ roomId }) => {
    try {
      const room = rooms.get(roomId);
      if (room && room.participants.has(socket.id)) {
        const participant = room.participants.get(socket.id);
        participant.isReady = true;
        
        console.log(`📹 ${participant.userName} is ready for video in room ${roomId}`);
        
        // Find other ready participants and initiate calls
        for (let [socketId, otherParticipant] of room.participants) {
          if (socketId !== socket.id && otherParticipant.isReady) {
            // Send call request to first available participant
            io.to(socketId).emit("room-call-request", {
              from: socket.id,
              fromName: participant.userName,
              roomId: roomId
            });
            console.log(`📞 Sent call request from ${participant.userName} to ${otherParticipant.userName}`);
            break; // For now, just connect to first available person
          }
        }
      }
    } catch (error) {
      console.error("❌ Room call ready error:", error);
    }
  });

  // Direct call initiation
  socket.on("call:initiate", ({ to, callType, callId }) => {
    try {
      console.log(`📞 Call initiation: ${socket.userId || socket.id} -> ${to}`);
      
      const targetSocket = findSocketByUserId(to);
      if (!targetSocket) {
        socket.emit("call:failed", { 
          message: "User not found or offline" 
        });
        return;
      }

      const targetUser = users.get(to);
      if (targetUser && targetUser.isBusy) {
        socket.emit("call:busy", { 
          message: "User is busy" 
        });
        return;
      }

      // Set both users as busy
      const caller = users.get(socket.userId);
      if (caller) {
        caller.isBusy = true;
        caller.callId = callId;
      }
      if (targetUser) {
        targetUser.isBusy = true;
        targetUser.callId = callId;
      }

      socket.callId = callId;
      targetSocket.callId = callId;

      // Send call invitation
      targetSocket.emit("call:incoming", {
        callerId: socket.userId || socket.id,
        callType: callType,
        callId: callId,
        socketId: socket.id
      });

      console.log(`📞 Call sent to ${to}`);
      
    } catch (error) {
      console.error("❌ Call initiation error:", error);
      socket.emit("call:failed", { message: "Call failed" });
    }
  });

  // Call acceptance
  socket.on("call:accept", ({ callId }) => {
    try {
      console.log(`✅ Call accepted: ${callId}`);
      
      // Find the caller
      const allSockets = io.sockets.sockets;
      for (let [socketId, sock] of allSockets) {
        if (sock.callId === callId && sock.id !== socket.id) {
          sock.emit('call:accepted', { callId });
          console.log(`✅ Notified caller ${sock.id} of acceptance`);
          break;
        }
      }
      
    } catch (error) {
      console.error("❌ Call accept error:", error);
    }
  });

  // Call rejection
  socket.on("call:reject", ({ callId }) => {
    try {
      console.log(`❌ Call rejected: ${callId}`);
      
      // Find the caller and notify
      const allSockets = io.sockets.sockets;
      for (let [socketId, sock] of allSockets) {
        if (sock.callId === callId && sock.id !== socket.id) {
          sock.emit('call:rejected', { callId });
          
          // Reset states
          sock.callId = null;
          sock.isBusy = false;
          
          const otherUser = findUserBySocketId(sock.id);
          if (otherUser) {
            otherUser.isBusy = false;
            otherUser.callId = null;
          }
          
          console.log(`❌ Notified caller ${sock.id} of rejection`);
          break;
        }
      }
      
      // Reset current socket state
      socket.callId = null;
      socket.isBusy = false;
      
      const currentUser = findUserBySocketId(socket.id);
      if (currentUser) {
        currentUser.isBusy = false;
        currentUser.callId = null;
      }
      
    } catch (error) {
      console.error("❌ Call reject error:", error);
    }
  });

  // Call end
  socket.on("call:end", ({ callId }) => {
    try {
      console.log(`📴 Call ended: ${callId}`);
      
      // Find other participant and notify
      const allSockets = io.sockets.sockets;
      for (let [socketId, sock] of allSockets) {
        if (sock.callId === callId && sock.id !== socket.id) {
          sock.emit('call:ended', { 
            callId, 
            duration: 0,
            status: 'ended' 
          });
          
          // Reset states
          sock.callId = null;
          sock.isBusy = false;
          
          const otherUser = findUserBySocketId(sock.id);
          if (otherUser) {
            otherUser.isBusy = false;
            otherUser.callId = null;
          }
          
          console.log(`📴 Notified participant ${sock.id} of call end`);
          break;
        }
      }
      
      // Reset current socket state
      socket.callId = null;
      socket.isBusy = false;
      
      const currentUser = findUserBySocketId(socket.id);
      if (currentUser) {
        currentUser.isBusy = false;
        currentUser.callId = null;
      }
      
    } catch (error) {
      console.error("❌ Call end error:", error);
    }
  });

  // WebRTC Signaling
  socket.on("offer", ({ offer, to }) => {
    try {
      console.log(`📡 Relaying offer to: ${to}`);
      
      // For room calls, 'to' is socket ID
      // For direct calls, 'to' might be user ID
      let targetSocket = io.sockets.sockets.get(to);
      
      if (!targetSocket) {
        // Try finding by user ID
        targetSocket = findSocketByUserId(to);
      }
      
      if (targetSocket) {
        targetSocket.emit("offer", { 
          offer, 
          from: socket.userId || socket.id 
        });
        console.log(`📡 Offer relayed successfully`);
      } else {
        console.log(`❌ Target socket not found: ${to}`);
      }
      
    } catch (error) {
      console.error("❌ Offer relay error:", error);
    }
  });

  socket.on("answer", ({ answer, to }) => {
    try {
      console.log(`📡 Relaying answer to: ${to}`);
      
      let targetSocket = io.sockets.sockets.get(to);
      
      if (!targetSocket) {
        targetSocket = findSocketByUserId(to);
      }
      
      if (targetSocket) {
        targetSocket.emit("answer", { 
          answer, 
          from: socket.userId || socket.id 
        });
        console.log(`📡 Answer relayed successfully`);
      } else {
        console.log(`❌ Target socket not found: ${to}`);
      }
      
    } catch (error) {
      console.error("❌ Answer relay error:", error);
    }
  });

  socket.on("ice-candidate", ({ candidate, to }) => {
    try {
      console.log(`🧊 Relaying ICE candidate to: ${to}`);
      
      let targetSocket = io.sockets.sockets.get(to);
      
      if (!targetSocket) {
        targetSocket = findSocketByUserId(to);
      }
      
      if (targetSocket) {
        targetSocket.emit("ice-candidate", { 
          candidate, 
          from: socket.userId || socket.id 
        });
      } else {
        console.log(`❌ Target socket not found for ICE: ${to}`);
      }
      
    } catch (error) {
      console.error("❌ ICE candidate relay error:", error);
    }
  });

  // Media state updates
  socket.on("media-state", ({ to, video, audio }) => {
    try {
      let targetSocket = io.sockets.sockets.get(to);
      
      if (!targetSocket) {
        targetSocket = findSocketByUserId(to);
      }
      
      if (targetSocket) {
        targetSocket.emit("media-state", { 
          from: socket.userId || socket.id,
          video, 
          audio 
        });
        console.log(`📡 Media state relayed: video=${video}, audio=${audio}`);
      }
      
    } catch (error) {
      console.error("❌ Media state relay error:", error);
    }
  });

  // Chat functionality
  socket.on("chat:message", ({ to, message }) => {
    try {
      let targetSocket = findSocketByUserId(to);
      
      if (targetSocket) {
        targetSocket.emit("chat:message", {
          from: socket.userId || socket.userName || socket.id,
          message: message,
          timestamp: new Date().toISOString()
        });
        
        socket.emit("chat:message-sent", {
          to: to,
          message: message,
          timestamp: new Date().toISOString()
        });
        
        console.log(`💬 Message relayed: ${socket.userId} -> ${to}`);
      } else {
        socket.emit("chat:delivery-failed", {
          to: to,
          message: "User not available",
          originalMessage: message
        });
      }
      
    } catch (error) {
      console.error("❌ Chat message error:", error);
    }
  });

  socket.on("chat:room-message", ({ roomId, message }) => {
    try {
      if (socket.roomId === roomId) {
        socket.to(roomId).emit("chat:message", {
          from: socket.userName || socket.id,
          message: message,
          timestamp: new Date().toISOString()
        });
        console.log(`💬 Room message sent in ${roomId}: ${message}`);
      }
    } catch (error) {
      console.error("❌ Room chat error:", error);
    }
  });

  // Disconnect handling
  socket.on("disconnect", () => {
    console.log("🔌 User disconnected:", socket.id);
    
    try {
      // Handle room cleanup
      if (socket.roomId) {
        const room = rooms.get(socket.roomId);
        if (room) {
          const participant = room.participants.get(socket.id);
          room.participants.delete(socket.id);
          
          // Notify other participants
          socket.to(socket.roomId).emit("participant-left", { 
            participant: participant,
            participants: getRoomParticipants(socket.roomId) 
          });
          
          // Delete room if empty
          if (room.participants.size === 0) {
            rooms.delete(socket.roomId);
            console.log(`🗑️ Deleted empty room: ${socket.roomId}`);
          }
          
          console.log(`🏠 ${participant?.userName || 'User'} left room ${socket.roomId}`);
        }
      }
      
      // Handle direct user cleanup
      const user = findUserBySocketId(socket.id);
      if (user) {
        users.delete(user.userId);
        console.log(`🗑️ Removed user: ${user.userId}`);
      }
      
      // Handle active call cleanup
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
            
            const otherUser = findUserBySocketId(sock.id);
            if (otherUser) {
              otherUser.isBusy = false;
              otherUser.callId = null;
            }
            
            console.log(`📴 Notified participant ${sock.id} about disconnection`);
            break;
          }
        }
      }
      
      socket.isBusy = false;
      socket.callId = null;
      
    } catch (error) {
      console.error("❌ Disconnect cleanup error:", error);
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    rooms: rooms.size,
    users: users.size,
    activeConnections: io.sockets.sockets.size
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