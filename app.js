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
    console.log(`User ${userId} registered and joined room ${userId}`);
  });

    socket.on("chat:message", ({ to, message, from }) => {
    io.to(to).emit("chat:message", { from, message });
  });

  // Call initiation
  socket.on('call:initiated', async ({ callerId, receiverId, callType }) => {
    try {
      const receiverSockets = await io.in(receiverId.toString()).fetchSockets();

      if (receiverSockets.length === 0) {
        // Receiver offline — log missed call & notify caller
        const call = await CallLog.create({
          callerId,
          receiverId,
          callType,
          status: 'missed',
          startedAt: new Date(),
          endedAt: new Date()
        });

        io.to(callerId.toString()).emit('call:busy', { message: 'User is offline', callId: call.id });
        return;
      }

      // Check if receiver is busy on any socket
      const receiverBusy = receiverSockets.some(s => s.isBusy);
      if (receiverBusy) {
        const call = await CallLog.create({
          callerId,
          receiverId,
          callType,
          status: 'missed',
          startedAt: new Date(),
          endedAt: new Date()
        });

        io.to(callerId.toString()).emit('call:busy', { message: 'User is busy', callId: call.id });
        return;
      }

      // Create call record with "attempted" status
      const call = await CallLog.create({
        callerId,
        receiverId,
        callType,
        status: 'attempted',
        startedAt: new Date(),
      });

      socket.callId = call.id;

      // Notify receiver with caller's socketId (important for signaling)
      const receiverSocket = receiverSockets[0]; // pick first socket for simplicity
      const receiverSocketId = receiverSocket.id;

      io.to(receiverSocketId).emit("call:incoming", {
        callerId,
        callType,
        callId: call.id,
        socketId: socket.id  // send caller's socket.id for signaling
      });

    } catch (err) {
      console.error('Call initiation error:', err);
    }
  });

  // Call acceptance
  socket.on('call:accepted', async ({ callId }) => {
    try {
      await CallLog.update(
        { status: 'connected' },
        { where: { id: callId } }
      );

      const call = await CallLog.findByPk(callId);
      if (!call) return;

      // Mark caller and receiver sockets as busy
      const callerSockets = await io.in(call.callerId.toString()).fetchSockets();
      const receiverSockets = await io.in(call.receiverId.toString()).fetchSockets();
      callerSockets.forEach(s => s.isBusy = true);
      receiverSockets.forEach(s => s.isBusy = true);

      // Notify caller that call was accepted
      io.to(call.callerId.toString()).emit('call:accepted', { callId });
    } catch (err) {
      console.error('Call acceptance error:', err);
    }
  });

  // WebRTC signaling handlers - FIXED TO MATCH CLIENT EVENTS
  socket.on("offer", ({ offer, to }) => {
    console.log(`Relaying offer from ${socket.id} to user ${to}`);
    io.to(to.toString()).emit("offer", { from: socket.id, offer });
  });

  socket.on("answer", ({ answer, to }) => {
    console.log(`Relaying answer from ${socket.id} to user ${to}`);
    io.to(to.toString()).emit("answer", { from: socket.id, answer });
  });

  socket.on("ice-candidate", ({ candidate, to }) => {
    console.log(`Relaying ICE candidate from ${socket.id} to user ${to}`);
    io.to(to.toString()).emit("ice-candidate", { from: socket.id, candidate });
  });

  // Call rejection
  socket.on("call:rejected", async ({ callId }) => {
    try {
      const call = await CallLog.findByPk(callId);
      if (call) {
        await call.update({ status: "missed", endedAt: new Date() });
        io.to(call.callerId.toString()).emit("call:rejected", { callId });
        io.to(call.receiverId.toString()).emit("call:rejected", { callId });
      }
    } catch (err) {
      console.error("Call rejection error:", err);
    }
  });

  // Call cancellation
  socket.on("call:cancelled", async ({ callId }) => {
    try {
      const call = await CallLog.findByPk(callId);
      if (call) {
        await call.update({ status: "cancelled", endedAt: new Date() });
        io.to(call.receiverId.toString()).emit("call:cancelled", { callId });
      }
    } catch (err) {
      console.error("Call cancel error:", err);
    }
  });

  // Call timeout
  socket.on("call:timeout", async ({ callId }) => {
    try {
      const call = await CallLog.findByPk(callId);
      if (call) {
        await call.update({ status: "missed", endedAt: new Date() });
        io.to(call.receiverId.toString()).emit("call:missed", { callerId: call.callerId });
        io.to(call.callerId.toString()).emit("call:noAnswer", { message: "No response from user" });
      }
    } catch (err) {
      console.error("Call timeout error:", err);
    }
  });

  // Call ended
  socket.on('call:ended', async ({ callId }) => {
    try {
      const call = await CallLog.findByPk(callId);
      if (call) {
        const duration = Math.floor((new Date() - call.startedAt) / 1000);
        
        await call.update({
          status: 'completed',
          endedAt: new Date(),
        });

        // Reset busy flags
        const callerSockets = await io.in(call.callerId.toString()).fetchSockets();
        const receiverSockets = await io.in(call.receiverId.toString()).fetchSockets();
        callerSockets.forEach(s => s.isBusy = false);
        receiverSockets.forEach(s => s.isBusy = false);

        io.to(call.callerId.toString()).emit('call:ended', { callId, duration, status: 'completed' });
        io.to(call.receiverId.toString()).emit('call:ended', { callId, duration, status: 'completed' });
      }
    } catch (err) {
      console.error('Call ended error:', err);
    }
  });

  // User disconnect cleanup
  socket.on("disconnect", async () => {
    console.log("User disconnected:", socket.id);
    
    // Reset busy flag
    socket.isBusy = false;
    
    if (socket.callId) {
      try {
        const call = await CallLog.findByPk(socket.callId);
        if (call && ['attempted', 'connected'].includes(call.status)) {
          await call.update({ status: "missed", endedAt: new Date() });
          
          // Notify the other party about disconnection
          if (call.callerId.toString() !== socket.id) {
            io.to(call.callerId.toString()).emit("call:ended", { 
              callId: call.id, 
              duration: Math.floor((new Date() - call.startedAt) / 1000),
              status: 'disconnected' 
            });
          }
          if (call.receiverId.toString() !== socket.id) {
            io.to(call.receiverId.toString()).emit("call:ended", { 
              callId: call.id, 
              duration: Math.floor((new Date() - call.startedAt) / 1000),
              status: 'disconnected' 
            });
          }
        }
      } catch (err) {
        console.error("Disconnect cleanup error:", err);
      }
    }
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
const PORT = 3002;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});


module.exports = app;