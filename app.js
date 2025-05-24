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
callog.sync({force:true})
const room = require('./model/room');
room.sync({force:true})
// Removed duplicate declaration of io

const user = require('./model/user');
user.sync({force:true})
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // User registration
  socket.on("register", (userId) => {
    socket.join(userId.toString());
    console.log(`User ${userId} registered and joined room ${userId}`);
  });

  // Call initiation
  socket.on('call:initiated', async ({ callerId, receiverId, callType }) => {
    try {
      const receiverSockets = await io.in(receiverId.toString()).fetchSockets();
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
      
      const call = await CallLog.create({
        callerId,
        receiverId,
        callType,
        status: 'attempted',
        startedAt: new Date(),
      });

      socket.callId = call.id;
      io.to(receiverId.toString()).emit('call:incoming', {
        callerId,
        callType,
        callId: call.id
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
      const callerSockets = await io.in(call.callerId.toString()).fetchSockets();
      const receiverSockets = await io.in(call.receiverId.toString()).fetchSockets();
      callerSockets.forEach(s => s.isBusy = true);
      receiverSockets.forEach(s => s.isBusy = true);

      io.to(call.callerId.toString()).emit('call:accepted');
    } catch (err) {
      console.error('Call acceptance error:', err);
    }
  });

  // WebRTC signaling messages
  socket.on("webrtc:offer", ({ to, offer }) => {
    io.to(to.toString()).emit("webrtc:offer", { from: socket.id, offer });
  });

  socket.on("webrtc:answer", ({ to, answer }) => {
    io.to(to.toString()).emit("webrtc:answer", { from: socket.id, answer });
  });

  socket.on("webrtc:ice-candidate", ({ to, candidate }) => {
    io.to(to.toString()).emit("webrtc:ice-candidate", { from: socket.id, candidate });
  });

  // Call rejection
  socket.on("call:rejected", async ({ callId }) => {
    try {
      const call = await CallLog.findByPk(callId);
      if (call) {
        await call.update({ status: "missed", endedAt: new Date() });
        io.to(call.callerId.toString()).emit("call:busy", { message: "User is busy" });
        io.to(call.receiverId.toString()).emit("call:missed", { callerId: call.callerId });
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
        io.to(call.receiverId.toString()).emit("call:cancelled");
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

  // Call ending
  socket.on('call:ended', async ({ callId }) => {
    try {
      const call = await CallLog.findByPk(callId);
      if (call) {
        await call.update({
          status: 'completed',
          endedAt: new Date(),
        });

        const callerSockets = await io.in(call.callerId.toString()).fetchSockets();
        const receiverSockets = await io.in(call.receiverId.toString()).fetchSockets();
        callerSockets.forEach(s => s.isBusy = false);
        receiverSockets.forEach(s => s.isBusy = false);

        io.to(call.callerId.toString()).emit('call:ended', { callId });
        io.to(call.receiverId.toString()).emit('call:ended', { callId });
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
        if (call && call.status === "attempted") {
          await call.update({ status: "missed", endedAt: new Date() });
          io.to(call.receiverId.toString()).emit("call:missed", { callerId: call.callerId });
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
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});


module.exports = app;
