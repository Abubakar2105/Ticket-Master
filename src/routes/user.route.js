
const express = require("express");
const router = express.Router();
const {authenticateUser, authorizeAdmin} = require("../middleware/auth.middleware")
const 
  {registerUser, loginUser} =
require("../controllers/user.controller");
const { getUsers, getUserById } = require("../controllers/query/user.controller");

router.post("/register", registerUser);
router.post("/login", loginUser);

router.get("/", authenticateUser ,authorizeAdmin, getUsers);
router.get("/:id", authenticateUser, getUserById);

module.exports = router;