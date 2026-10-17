const commandPrisma = require("../config/command-prisma");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const registerUser = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({
        message: "Username,email and password is required",
      });
    }
    const existingUser = await commandPrisma.user.findFirst({
      where: {
        OR: [{ username }, { email }],
      },
    });
    if (existingUser) {
      return res.status(409).json({
        message: "Username or email already exists",
      });
    }
    const hashPass = await bcrypt.hash(password, 12);
    const user = await commandPrisma.user.create({
      data: {
        username,
        email,
        password: hashPass,
        is_admin: true
      },
      select: {
        id: true,
        username: true,
        email: true,
        is_admin: true,
      },
    });
    return res.status(201).json({
      message: "User registered successfully",
      user,
    });
  } catch (error) {
    console.error("Registration error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

const getUsers = async (req, res) => {
  try {
    const users = await commandPrisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        is_admin: true,
      },
    });

    return res.status(200).json({ users, count: users.length });
  } catch (error) {
    console.error("Get users error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await commandPrisma.user.findUnique({
      where: {
        id,
      },
      select: {
        username,
        email,
        is_admin,
      },
    });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({ user });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch user" });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }
    const user = await commandPrisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }
    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return res.status(401).json({ message: "Invalid email or password" });
    }
    const token = jwt.sign(
      {
        id: user.id,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" },
    );
    return res
      .status(200)
      .json({
        message: "Login successful",
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          is_admin: user.is_admin,
        },
      });
  } catch (error) {
    return res.status(500).json({ message: "Login failed", error:error.message });
  }
};



module.exports = { getUsers, getUserById, loginUser, registerUser };
