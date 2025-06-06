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
const { Socket } = require('dgram');
// user.sync({force:true})
// Store room information
const rooms = {}; // { roomId: Set(socketIds) }
const roomCreators = {}; // { roomId: socketId }

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join', (roomId) => {
    socket.join(roomId);
    console.log(`${socket.id} joined ${roomId}`);

    // Set creator if not already set
    if (!roomCreators[roomId]) {
      roomCreators[roomId] = socket.id;
    }

    // Emit existing users to new user (excluding themselves)
    const otherUsers = [...io.sockets.adapter.rooms.get(roomId) || []].filter(id => id !== socket.id);
    socket.emit('all-users', otherUsers);

    // Notify if this user is the creator
    socket.emit('is-creator', socket.id === roomCreators[roomId]);

    // Notify others of new user
    socket.to(roomId).emit('user-joined', socket.id);
  });

  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', { from: socket.id, offer });
  });

  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  socket.on('chat-message', ({ room, msg }) => {
    socket.to(room).emit('chat-message', { from: socket.id, msg });
  });

  socket.on('leave', (roomId) => {
    socket.leave(roomId);
    socket.to(roomId).emit('user-left', socket.id);

    if (roomCreators[roomId] === socket.id) {
      delete roomCreators[roomId];
    }
  });

  // ✅ FIXED: Whiteboard draw - send full draw data
  socket.on('whiteboard-draw', (data) => {
    const { roomId } = data;
    if (roomCreators[roomId] === socket.id) {
      socket.to(roomId).emit('whiteboard-draw', data); // send entire drawing info
    }
  });
    // ✅ FIXED: Whiteboard draw - send full draw data
  socket.on('whiteboard-shape', (data) => {
    const { roomId } = data;
    if (roomCreators[roomId] === socket.id) {
      socket.to(roomId).emit('whiteboard-shape', data); // send entire drawing info
    }
  });
  socket.on('whiteboard-text', (data) => {
    const { roomId } = data;
    if (roomCreators[roomId] === socket.id) {
      socket.to(roomId).emit('whiteboard-text', data); // send entire text info
    }
  }
  );



  // ✅ Whiteboard clear
  socket.on('whiteboard-clear', (roomId) => {
    if (roomCreators[roomId] === socket.id) {
      socket.to(roomId).emit('whiteboard-clear');
    }
  });

  socket.on('disconnecting', () => {
    const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    rooms.forEach(roomId => {
      socket.to(roomId).emit('user-left', socket.id);

      if (roomCreators[roomId] === socket.id) {
        delete roomCreators[roomId];
      }
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
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