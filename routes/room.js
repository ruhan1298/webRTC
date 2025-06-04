var express = require('express');
const userAuth = require('../middleware/userAuth');
var router = express.Router();
const { v4: uuidv4 } = require('uuid');
const Room = require('../model/room'); // Assuming you have a Room model defined

router.get('/link', function(req, res, next) {
  res.render('createlink', { title: 'Express' });
});

router.post('/room-create',userAuth, async function(req, res) { 
 try {
    const createdBy = req.user.id; // Get the user ID from the request
    const { title, scheduledTime, duration } = req.body; // Extract data from request body
        const isScheduled = !!scheduledTime;
    const roomId = uuidv4();
    const room = await Room.create({
      id: roomId,
      createdBy,
      title,
      scheduledTime: isScheduled ? new Date(scheduledTime) : null,
      duration,
      status: isScheduled ? 'scheduled' : 'active'
    });
    console.log(room, "Room Created >>>>>>>>>>>>>>>>>>>>>");
    return res.status(200).json({
        status: 1,
           message: isScheduled ? 'Meeting scheduled' : 'Instant meeting started',
      joinUrl: `https://yourapp.com/meet/${roomId}`,
      room

    });
    

 } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
    
 }
);
module.exports = router;


