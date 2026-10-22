const queryPrisma = require("../../config/query-prisma");
const cache = require("../../utils/cache");

const getUsers = async (_, res) => {
  try {
    const cacheUser = await cache.get("users:all");

  
    if (cacheUser !== null) {
      return res.status(200).json({
        users: cacheUser,
        count: cacheUser.length,
      });
    }

    const users = await queryPrisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        is_admin: true,
      },
    });

    await cache.set("users:all", 60, users);

    return res.status(200).json({
      users,
      count: users.length,
    });
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

    const cacheUser = await cache.get(`user:${id}`);

    if (cacheUser !== null) {
      return res.status(200).json({ user: cacheUser });
    }

    const user = await queryPrisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
        is_admin: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    await cache.set(`user:${id}`, 60, user);

    return res.status(200).json({ user });
  } catch (error) {
    console.error("Get user by ID error:", error);

    return res.status(500).json({
      message: "Failed to fetch user",
    });
  }
};

module.exports = { getUsers, getUserById };
