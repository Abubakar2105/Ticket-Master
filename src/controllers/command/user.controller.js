const commandPrisma = require("../../config/command-prisma");
const { append } = require("../../events/store");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const registerUser = async (req, res) => {
  try {
    const { username, email, password } = req.body || {};

    if (
      typeof username !== "string" ||
      !username.trim() ||
      username.trim().length > 100 ||
      typeof email !== "string" ||
      !email.trim() ||
      email.trim().length > 255 ||
      typeof password !== "string" ||
      !password ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({
        message: "A valid username, email, and password (at most 72 bytes) are required",
      });
    }

    const hashPass = await bcrypt.hash(password, 12);
    const user = await commandPrisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          username: username.trim(),
          email: email.trim(),
          password: hashPass,
          is_admin: false,
        },
        select: {
          id: true,
          username: true,
          email: true,
          is_admin: true,
          createdAt: true,
        },
      });

      await append({
        eventType: "user-created",
        aggregateId: createdUser.id,
        payload: createdUser,
      }, tx);

      return createdUser;
    });

    return res.status(201).json({
      message: "User registered successfully",
      user,
    });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({
        message: "Username or email already exists",
      });
    }

    console.error("Registration error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (
      typeof email !== "string" ||
      !email.trim() ||
      email.trim().length > 255 ||
      typeof password !== "string" ||
      !password ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({
        message: "A valid email and password are required",
      });
    }

    const user = await commandPrisma.user.findUnique({
      where: { email: email.trim() },
    });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "1d" });

    return res.status(200).json({
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
    console.error("Login error:", error);
    return res.status(500).json({ message: "Login failed" });
  }
};

module.exports = { loginUser, registerUser };
