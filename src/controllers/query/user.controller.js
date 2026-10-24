const queryPrisma = require("../../config/query-prisma");
const cache = require("../../utils/cache");

const getUsers = async (_, res) => {
  try {
    const cachedData = await cache.get("users:all");
    if (cachedData !== null) {
      return res.status(200).json({ users: cachedData, count: cachedData.length });
    }

    const users = await queryPrisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        is_admin: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    await cache.set("users:all", 60, users);

    return res.status(200).json({ users, count: users.length });
  } catch (error) {
    console.error("Get users error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    if (typeof id !== "string" || !id.trim()) {
      return res.status(400).json({ message: "A valid user id is required" });
    }

    if (!req.user?.id) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const userId = id.trim();
    if (req.user.id !== userId && req.user.is_admin !== true) {
      return res.status(403).json({ message: "You can only view your own user profile" });
    }

    const cachedData = await cache.get(`user:${userId}`);
    if (cachedData !== null) {
      return res.status(200).json({ user: cachedData });
    }

    const user = await queryPrisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        is_admin: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await cache.set(`user:${userId}`, 60, user);
    return res.status(200).json({ user });
  } catch (error) {
    console.error("Get user by ID error:", error);
    return res.status(500).json({ message: "Failed to fetch user" });
  }
};

module.exports = { getUsers, getUserById };
