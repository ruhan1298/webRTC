var express = require('express');
var router = express.Router();
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/key');
const User = require('../model/user');
const { Op } = require('sequelize');
const bcrypt = require('bcrypt');
const userAuth = require('../middleware/userAuth')
const calling = require('../model/calllog');

/* GET users listing. */
router.get('/', function(req, res, next) {
  res.send('respond with a resource');
});
router.post('/register', async function(req, res) {
  try {
      const { email, password, Name, mobilenumber,  } = req.body;

      // Check if the user already exists
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
          return res.status(400).json({ status: 1, message: 'User already exists' });
      }

      // Hash the password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create a new user
      const newUser = await User.create({
          email,
          password: hashedPassword,
          Name,
          mobilenumber,
      
      });

      // Create a JWT token
      const token = jwt.sign(
          { id: newUser.id }, // Payload
          JWT_SECRET, // Secret key
          { expiresIn: '1000hr' } // Token expiration
      );

      // Send response
      return res.status(201).json({
          status: 1,
          message: 'Registration Successful',
          data: {
              id: newUser.id.toString(),
              Name: newUser.Name,
              LastName: newUser.LastName,
              email: newUser.email,
              mobilenumber: newUser.mobilenumber,
              token: token,
              deviceToken: newUser.deviceToken,
              Device_type: newUser.Device_type
          },
      });
  } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Internal Server Error' });
  }
})
router.post('/login', async function(req, res) {
  try {
      const { email, password } = req.body;
      console.log(req.body, "BODY>>>>>>>>>");

      // Find the user by email
      const loginResult = await User.findOne({ where: { email } });

      if (!loginResult) {
          return res.json({ status: 1, message: 'Invalid email' });
      }

      // Check if password is provided
      if (!password) {
          return res.status(200).json({ status: 1, message: 'Invalid Password' });
      }

      // Verify the password using bcrypt
      const passwordMatch = await bcrypt.compare(password, loginResult.password);
      if (!passwordMatch) {
          return res.status(200).json({ status: 1, message: 'Invalid password' });
      }

      // Create a JWT token
      const token = jwt.sign(
          { id: loginResult.id }, // Payload
          JWT_SECRET, // Secret key
          { expiresIn: '1000hr' } // Token expiration
      );

      // Decode the token to check the payload
      const decodedToken = jwt.decode(token);
      console.log(decodedToken.id, "Decoded ID from Token >>>>>>>>>>>>>");

      // Send response
      return res.status(200).json({
          status: 1,
          message: 'Login Successfully',
          data: {
              id: loginResult.id.toString(),
              Name: loginResult.Name,
              LastName: loginResult.LastName,
              email: loginResult.email,
              mobilenumber: loginResult.mobilenumber,
              token: token,
              deviceToken: loginResult.deviceToken,
              Device_type: loginResult.Device_type
          },
      });
  } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Internal Server Error' });
  }

});
router.get('/user-list',userAuth, async function(req, res) {
    try {
        const userId = req.user.id; // Get the user ID from the request

        const userList = await User.findAll({
            where: {
                id: {
                    [Op.ne]: userId // Exclude the current user
                }
            },
            attributes: ['id','Name', 'email', 'mobilenumber'],
            order: [['Name', 'ASC']] // Optional: Order by Name
        });
        console.log(userList, "User List >>>>>>>>>>>>>>>>>>>>>");
        if (userList.length === 0) {
            return res.status(200).json({ status: 1, message: 'No Users Found' });
        }
        return res.status(200).json({
            status: 1,
            message: 'User List',
            data: userList,
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal Server Error' });
        
    }
})

router.post('/call-history',userAuth, async function(req, res) {
    try {
        const userId = req.user.id; // Get the user ID from the request
const gethistory = await calling.findAll({
    where: {
        [Op.or]: [
            { callerId: userId },
            { receiverId: userId }
        ],
    },
    include: [
        { model: User, as: 'caller', attributes: ['id', 'name'] },
        { model: User, as: 'receiver', attributes: ['id', 'name'] }
      ],
      order: [['startedAt', 'DESC']]
}); // Closing brackets added here
        console.log(gethistory, "Call History >>>>>>>>>>>>>>>>>>>>>");
        if (gethistory.length === 0) {
            return res.status(200).json({ status: 1, message: 'No Call History Found' });
        }
        return res.status(200).json({
            status: 1,
            message: 'Call History',
            data: gethistory,
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal Server Error' });
    }   


})
router.post('/missed-call',userAuth, async function(req, res) {
    try {
        const userId = req.user.id; // Get the user ID from the request
const gethistory = await calling.findAll({
    where: {
       receiverId: userId,
       status: "missed"
    },
    include: [
        { model: User, as: 'caller', attributes: ['id', 'name'] },
        { model: User, as: 'receiver', attributes: ['id', 'name'] }
      ],
      order: [['startedAt', 'DESC']]
}); // Closing brackets added here
        console.log(gethistory, "Call History >>>>>>>>>>>>>>>>>>>>>");
        if (gethistory.length === 0) {
            return res.status(200).json({ status: 1, message: 'No Call History Found' });
        }
        return res.status(200).json({
            status: 1,
            message: 'MISSED Call History',
            data: gethistory,
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal Server Error' });
    }   


})

module.exports = router;
