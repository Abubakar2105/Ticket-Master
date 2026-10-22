const commandPrisma = require("../config/command-prisma");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const registerUser = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        message: "Username, email and password are required",
      });
    }

    const user = await commandPrisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findFirst({
        where: {
          OR: [{ username }, { email }],
        },
      });

      if (existingUser) {
        throw new Error("USER_ALREADY_EXISTS");
      }

      const hashPass = await bcrypt.hash(password, 12);

      const user = await tx.user.create({
        data: {
          username,
          email,
          password: hashPass,
          is_admin: false,
        },
        select: {
          id: true,
          username: true,
          email: true,
          is_admin: true,
        },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: "user-created",
          aggregateId: user.id,
          payload: user,
          status: "PENDING",
        },
      });

      return user;
    });

    return res.status(201).json({
      message: "User registered successfully",
      user,
    });
  } catch (error) {
    if (error.message === "USER_ALREADY_EXISTS") {
      return res.status(409).json({
        message: "Username or email already exists",
      });
    }

    console.error("Registration error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
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



module.exports = {loginUser, registerUser };
