// const {  DataTypes } = require('sequelize');
// const sequelize = require('../model/index')

// // Changess

// const CallLog  = sequelize.define('CallLog', {
//   // Model attributes are defined here
//   callerId: {
//     type: DataTypes.INTEGER,
//     allowNull: false
//   },
//   receiverId: {
//     type: DataTypes.INTEGER,
//     allowNull: false
//   },
//   callType: {
//     type: DataTypes.ENUM("audio", "video"),
//     defaultValue: "video"
//   },
//   status: {
//     type: DataTypes.ENUM("missed", "rejected", "answered", "attempted", "cancelled", "connected", "completed"),
//     defaultValue: "attempted"
//   },
  
//   startedAt: DataTypes.DATE,
//   endedAt: DataTypes.DATE
// });
// const User = require('./user')  // Assuming you have a User model defined in user.js
// CallLog.belongsTo(User, { as: 'caller', foreignKey: 'callerId' });
// CallLog.belongsTo(User, { as: 'receiver', foreignKey: 'receiverId'}); 



// module.exports=CallLog 