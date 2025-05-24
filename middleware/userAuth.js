
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/key');
// const = require('../config/key')
// const key = 'yoursecretkey';
// Update the userAuth middleware

const userAuth = async (req, res, next) => {
    const token = req.header('Authorization');

    if (!token) {
        return res.status(401).json({ status: 0, message: 'Invalid Token or No Token Provided' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = { id: decoded.id }; // Attach user ID to request
        console.log(req.user, 'User Authenticated...');
        next();
    } catch (ex) {
        return res.status(400).json({ status: 0, message: 'Invalid Token' });
    }
};

module.exports = userAuth;