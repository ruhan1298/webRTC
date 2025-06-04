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
io.on('connection', socket => {
  socket.on('join', room => {
    socket.join(room);
    socket.to(room).emit('user-joined', socket.id);
  });

  socket.on('offer', data => {
    socket.to(data.room).emit('offer', data.offer, socket.id);
  });

  socket.on('answer', data => {
    socket.to(data.room).emit('answer', data.answer, socket.id);
  });

  socket.on('ice-candidate', data => {
    socket.to(data.room).emit('ice-candidate', data.candidate, socket.id);
  });

  socket.on('chat-message', data => {
    socket.to(data.room).emit('chat-message', data);
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