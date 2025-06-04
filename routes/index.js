var express = require('express');
var router = express.Router();
const session = require('express-session');

const passport =require('passport')
/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('calling', { title: 'Express' });
});

router.get('/login', function(req, res, next) {
  res.render('Login');
});

router.post("/auth", (req, res, next) => {
    passport.authenticate("local", {
      successRedirect:  "/",
      failureRedirect: "/Login",
      
    })(req, res, next);
  });
  router.get("/logout", (req, res) => {
    req.logout(function (err) {
      if (err) {
        return next(err);
      }
      res.redirect( "/login");
    });
  });

module.exports = router;
