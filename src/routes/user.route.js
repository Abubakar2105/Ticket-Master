
const express = require("express");
const router = express.Router();
const {authenticateUser, authorizeAdmin} = require("../middleware/auth.middleware")
const 
  {registerUser, getUsers, loginUser, getUserById} =
require("../controllers/user.controller");

router.post("/register", registerUser);
router.post("/login", loginUser);

router.get("/", authenticateUser ,authorizeAdmin, getUsers);
router.get("/:id", authenticateUser, getUserById);

module.exports = router;