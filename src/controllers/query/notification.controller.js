const queryPrisma = require("../../config/query-prisma");
const cache = require("../../utils/cache");

const getUserNotifications = async (req, res) => {
  try {
    const { user_id } = req.params;
    if (!req.user?.id) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (typeof user_id !== "string" || !user_id.trim()) {
      return res.status(400).json({ message: "user_id is required" });
    }
    const userId = user_id.trim();
    if (req.user.id !== userId && req.user.is_admin !== true) {
      return res.status(403).json({ message: "You can only view your own notifications" });
    }

    const key = `notifications:user:${userId}`;
    const cachedNotifications = await cache.get(key);
    if (cachedNotifications !== null) {
      return res.status(200).json({ count: cachedNotifications.length, notifications: cachedNotifications });
    }
    if (req.user.id !== userId) {
      const user = await queryPrisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
    }
    const notifications = await queryPrisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    await cache.set(key, 60, notifications);
    return res.status(200).json({ count: notifications.length, notifications });
  } catch (error) {
    console.error("Get notifications error:", error);
    return res.status(500).json({ message: "Failed to retrieve notifications" });
  }
};

module.exports = { getUserNotifications };
