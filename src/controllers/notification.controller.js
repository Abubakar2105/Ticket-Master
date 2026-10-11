const prisma = require("../config/prisma");

const getUserNotifications = async (req, res) => {
  try {
    const { user_id } = req.params;

    // 1. Validate user ID
    if (!user_id?.trim()) {
      return res.status(400).json({
        message: "user_id is required",
      });
    }

    // 2. Ensure the user exists
    const user = await prisma.user.findUnique({
      where: { id: user_id },
      select: { id: true },
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    // 3. Get the user's notifications
    const notifications = await prisma.notification.findMany({
      where: {
        userId: user_id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // 4. Return notifications
    return res.status(200).json({
      count: notifications.length,
      notifications,
    });
  } catch (error) {
    console.error("Get notifications error:", error);

    return res.status(500).json({
      message: "Failed to retrieve notifications",
    });
  }
};

module.exports = { getUserNotifications };
