const express = require("express");
const router = express.Router();
const createPool = require("../db");
const multer = require("multer");
const s3 = require("./s3");

const jwt = require("jsonwebtoken");
const SECRET_KEY = "your_secret_key";

const db = createPool();

const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const token = authHeader.split(" ")[1];
    jwt.verify(token, SECRET_KEY, (err, user) => {
      if (err) {
        return res.sendStatus(403);
      }

      req.userId = user.userId;
      next();
    });
  } else {
    res.sendStatus(401);
  }
};

const Razorpay = require("razorpay");
const { v4: uuidv4 } = require("uuid");

// Initialize Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_ID,
  key_secret: process.env.RAZORPAY_KEY,
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

router.post("/order/create", authenticateJWT, async (req, res) => {
  const user_id = req.userId; // Assuming authenticateJWT middleware sets req.userId

  let connection;
  try {
    connection = await db.getConnection();

    if (!req.body.address_id) {
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "Address ID not found",
      });
    }

    // Validate that the address belongs to the user
    const validateAddressQuery =
      "SELECT id FROM address WHERE id = ? AND user_id = ?";
    const [addressResult] = await connection.query(validateAddressQuery, [
      req.body.address_id,
      user_id,
    ]);

    if (addressResult.length === 0) {
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "Invalid address ID for this user",
      });
    }

    // Check if a non-deleted cart exists for the user
    const searchCartQuery =
      "SELECT id, total_cost FROM cart WHERE user_id = ? AND deleted_at IS NULL";
    const [carts] = await connection.query(searchCartQuery, [user_id]);

    if (carts.length === 0) {
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "Cart not found",
      });
    }

    const cart_id = carts[0].id;
    const total_amount = carts[0].total_cost;

    // Create a Razorpay order
    const razorpayOptions = {
      amount: total_amount.toString(), // Convert to paise if using INR, multiply by 100 for minor unit conversion in other currencies
      currency: "USD",
      receipt: uuidv4(), // Use a UUID for the receipt, which can be tracked
      notes: {
        userId: user_id.toString(),
      },
    };

    console.log("Razorpay resposne".razorpayOptions);

    const razorpayOrder = await razorpay.orders.create(razorpayOptions);

    console.log("Razorpay resposne".razorpayOrder);

    // Use Razorpay order ID as the order UUID
    const order_uuid = razorpayOrder.id;

    // Create a new order in the database
    const createOrderQuery =
      "INSERT INTO orders (user_id, address_id, total_amount, status, created_at, uuid) VALUES (?, ?, ?, ?, NOW(), ?)";
    const [orderResult] = await connection.query(createOrderQuery, [
      user_id,
      req.body.address_id,
      total_amount,
      "pending",
      order_uuid,
    ]);

    const order_id = orderResult.insertId;

    // Get all items in the cart
    const getCartItemsQuery = `
          SELECT 
            cart_items.*, 
            product.totalPrice 
          FROM cart_items 
          JOIN product ON cart_items.product_id = product.id 
          WHERE cart_items.cart_id = ?
        `;
    const [cartItems] = await connection.query(getCartItemsQuery, [cart_id]);

    // Insert the cart items into order_items
    const createOrderItemQuery = `
          INSERT INTO order_items (order_id, product_id, cost, quantity)
          VALUES (?, ?, ?, ?)
        `;

    for (const item of cartItems) {
      await connection.query(createOrderItemQuery, [
        order_id,
        item.product_id,
        item.totalPrice,
        item.quantity,
      ]);
    }

    return res.status(200).send({
      status: 200,
      is_error: false,
      message: "Order successfully created",
      order_uuid: order_uuid,
      razorpay: razorpayOrder,
    });
  } catch (error) {
    console.error("Error creating order:", error.message);
    return res.status(500).send({
      status: 500,
      is_error: true,
      message: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

router.post("/order/update-status", authenticateJWT, async (req, res) => {
  const { order_id, status, transaction_id } = req.body;
  const user_id = req.userId; // Assuming authenticateJWT middleware sets req.userId

  if (!order_id || !status) {
    return res.status(400).send({
      status: 400,
      is_error: true,
      message: "Order ID and status are required.",
    });
  }
  if (!transaction_id) {
    return res.status(400).send({
      status: 400,
      is_error: true,
      message: "Transaction ID are required.",
    });
  }

  let connection;
  try {
    connection = await db.getConnection();

    // Update the order status
    const updateOrderStatusQuery = `
          UPDATE orders 
          SET status = ?, payment_id = ?
          WHERE uuid = ? AND user_id = ?
        `;
    await connection.query(updateOrderStatusQuery, [
      status,
      transaction_id,
      order_id,
      user_id,
    ]);

    // Check if the order status is "completed"
    if (status === "completed") {
      // Check if a non-deleted cart exists for the user
      const searchCartQuery =
        "SELECT id FROM cart WHERE user_id = ? AND deleted_at IS NULL";
      const [carts] = await connection.query(searchCartQuery, [user_id]);

      if (carts.length > 0) {
        const cart_id = carts[0].id;

        // Delete all items in the cart
        const deleteCartItemsQuery = `
              DELETE FROM cart_items 
              WHERE cart_id = ?
            `;
        await connection.query(deleteCartItemsQuery, [cart_id]);

        // Update the cart total cost to zero
        const updateCartTotalCostQuery =
          "UPDATE cart SET total_cost = 0 WHERE id = ?";
        await connection.query(updateCartTotalCostQuery, [cart_id]);
      }
    }

    return res.status(200).send({
      status: 200,
      is_error: false,
      message: "Order status successfully updated",
    });
  } catch (error) {
    console.error("Error updating order status:", error.message);
    return res.status(500).send({
      status: 500,
      is_error: true,
      message: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

router.get("/orders", authenticateJWT, async (req, res) => {
  const user_id = req.userId; // Assuming authenticateJWT middleware sets req.userId

  let connection;
  try {
    connection = await db.getConnection();

    // Get all orders for the user
    const getOrdersQuery = `
          SELECT 
            orders.*, 
            order_items.id AS order_item_id, 
            order_items.*, 
            product.* 
          FROM orders 
          JOIN order_items ON orders.id = order_items.order_id 
          JOIN product ON order_items.product_id = product.id 
          WHERE orders.user_id = ? 
        `;
    const [orders] = await connection.query(getOrdersQuery, [user_id]);

    return res.status(200).send({
      status: 200,
      is_error: false,
      message: "Orders retrieved successfully",
      orders: orders,
    });
  } catch (error) {
    console.error("Error retrieving orders:", error.message);
    return res.status(500).send({
      status: 500,
      is_error: true,
      message: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

router.get("/order-item/:id", authenticateJWT, async (req, res) => {
  const order_item_id = req.params.id;
  const user_id = req.userId; // Assuming authenticateJWT middleware sets req.userId

  let connection;
  try {
    connection = await db.getConnection();

    const getOrderItemQuery = `
            SELECT 
              order_items.*, 
              product.*
            FROM order_items 
            JOIN orders ON order_items.order_id = orders.id 
            JOIN product ON order_items.product_id = product.id 
            WHERE order_items.id = ? AND orders.user_id = ?
          `;
    const [orderItems] = await connection.query(getOrderItemQuery, [
      order_item_id,
      user_id,
    ]);

    if (orderItems.length === 0) {
      return res.status(404).send({
        status: 404,
        is_error: true,
        message: "Order item not found",
      });
    }

    const orderItem = orderItems[0];

    const signedUrlExpireSeconds = 60 * 5; // 5 minutes

    // Generate a signed URL for the image
    const signedUrl = s3.getSignedUrl("getObject", {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: orderItem.attachmentLink,
      Expires: signedUrlExpireSeconds,
    });

    return res.status(200).send({
      status: 200,
      is_error: false,
      message: "Order item retrieved successfully",
      order_item: orderItem,
      signed_url: signedUrl,
    });
  } catch (error) {
    console.error("Error retrieving order item:", error.message);
    return res.status(500).send({
      status: 500,
      is_error: true,
      message: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

module.exports = router;
