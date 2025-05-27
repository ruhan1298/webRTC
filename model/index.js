const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize('webrtc_9ecp', 'webrtcuser', 'Hp8OJSY9UfH1IKlFAQ1ttoKQ24XIjKro', {
  host:'dpg-d0ot65je5dus73d89vig-a',
  dialect: 'postgres',   // yahan dialect ko 'postgres' kar diya
  logging: false,
  port: 5432             // agar port change nahi kiya toh default 5432 hota hai
});

(async () => {
  try {
    await sequelize.authenticate();
    console.log('Database Connected successfully.');
  } catch (error) {
    console.error('Unable to connect to the database:', error);
  }
})();

module.exports = sequelize;
// const { Sequelize, DataTypes } = require('sequelize');



// const sequelize = new Sequelize('webrtc','root', 'Ruhan@4430', {
//     host: 'localhost',
//     dialect: 'mysql',
//     logging: false
//   });

//   try {
//      sequelize.authenticate();
//     console.log('Database Connected successfully.');
//   } catch (error) {
//     console.error('Unable to connect to the database:', error);
//   }
  
//   module.exports=sequelize
