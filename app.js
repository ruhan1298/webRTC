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
const rooms = {}; // { roomName: Set(socketId) }

io.on('connection', socket => {
  console.log('User connected:', socket.id);

  socket.on('join', room => {
    socket.join(room);

    if (!rooms[room]) rooms[room] = new Set();
    rooms[room].add(socket.id);

    // Send existing users in the room to the new user
    const otherUsers = Array.from(rooms[room]).filter(id => id !== socket.id);
    socket.emit('all-users', otherUsers);

    // Notify others that a new user joined
    socket.to(room).emit('user-joined', socket.id);

    // Relay offers, answers, and ICE candidates
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
      // Broadcast chat message to the room
      io.to(room).emit('chat-message', { from: socket.id, msg });
    });

    socket.on('leave', room => {
      socket.leave(room);
      if (rooms[room]) {
        rooms[room].delete(socket.id);
        socket.to(room).emit('user-left', socket.id);
      }
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      // Remove from all rooms and notify
      for (const roomName in rooms) {
        if (rooms[roomName].has(socket.id)) {
          rooms[roomName].delete(socket.id);
          socket.to(roomName).emit('user-left', socket.id);
        }
      }
    });
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