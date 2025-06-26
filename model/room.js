// const {  DataTypes } = require('sequelize');
// const sequelize = require('../model/index')


// const Room = sequelize.define('Room', {
//   id: {
//     type: DataTypes.STRING,
//     primaryKey: true,
//     allowNull: false,
//   },
//   createdBy: {
//     type: DataTypes.INTEGER,
//     allowNull: false,
//   },
//   title: {
//     type: DataTypes.STRING,
//     allowNull: true,
//   },
//   scheduledTime: {
//     type: DataTypes.DATE,
//     allowNull: true, // null if instant meeting
//   },
//   duration: {
//     type: DataTypes.INTEGER, // duration in minutes
//     allowNull: true,
//   },
//   status: {
//     type: DataTypes.ENUM('scheduled', 'active', 'completed'),
//     allowNull: false,
//     defaultValue: 'scheduled',
//   },
//   createdAt: {
//     type: DataTypes.DATE,
//     defaultValue: DataTypes.NOW,
//   }

//   // mobileNumber :{
//   //   type:
//   // },

  



// },
//  {
// });

// module.exports=Room