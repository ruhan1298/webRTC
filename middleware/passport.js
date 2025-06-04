const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const session = require('express-session');


// Load Model
const User = require('../model/user');

module.exports = function (passport) {
  passport.use(
    new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
      try {
        const admin = await User.findOne({ where: { email: email } });
        console.log(admin,"ADMIN");

        if (!admin) {
          console.log('Admin not found');
          return done(null, false, { message: 'That email is not registered' });
        }

        // Match password
        const isMatch = await bcrypt.compare(password, admin.password);

        if (isMatch) {
          console.log('Password matched');
          return done(null, admin);
        } else {
          console.log('Password incorrect');
          return done(null, false, { message: 'Password incorrect' });

        }
      } catch (err) {
        console.error(err);
        return done(err);
      }
    })
  );

  passport.serializeUser(function (admin, done) {
    done(null, admin.id);
  });

  passport.deserializeUser(async function (id, done) {
    try {
      const admin = await User.findByPk(id);
      console.log('Deserializing user:', admin);
      done(null, admin);
    } catch (err) {
      console.error(err);
      done(err);
    }
  });
};
