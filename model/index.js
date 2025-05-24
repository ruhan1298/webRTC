const { Sequelize, DataTypes } = require('sequelize');



const sequelize = new Sequelize('webrtc','root', 'Ruhan@4430', {
    host: 'localhost',
    dialect: 'mysql',
    logging: false
  });

  try {
     sequelize.authenticate();
    console.log('Database Connected successfully.');
  } catch (error) {
    console.error('Unable to connect to the database:', error);
  }
  
  module.exports=sequelize