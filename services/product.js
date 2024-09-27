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

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

router.post(
  "/product/create",
  authenticateJWT,
  upload.single("file"),
  async (req, res) => {
    console.log("Test");
    const { brand, model, price, totalPrice, title, description, features } =
      req.body;
    const file = req.file;

    if (!brand) {
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "Brand is required.",
      });
    }

    if (!model) {
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "Model is required.",
      });
    }

    if (!price || price < 0) {
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "Price is required.",
      });
    }

    if (!totalPrice || totalPrice < 0) {
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "Total price is required.",
      });
    }

    if (!title) {
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "Title is required.",
      });
    }

    if (!description) {
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "Description is required.",
      });
    }

    if (!features) {
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "Features are required.",
      });
    }

    if (!file) {
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "An image file is required.",
      });
    }

    let connection;
    try {
      connection = await db.getConnection();
      const key = `products/${Date.now()}_${file.originalname}`;
      const uploadParams = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
        Body: file.buffer,
      };
      console.log("Upload issue");
      const uploadResult = await s3.upload(uploadParams).promise();

      const insertQuery = `
            INSERT INTO product (brand, model, price, totalPrice, title, description, features, attachmentLink, created_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;
      const [result] = await connection.query(insertQuery, [
        brand,
        model,
        price,
        totalPrice,
        title,
        description,
        features,
        key,
      ]);

      return res.status(201).send({
        status: 201,
        is_error: false,
        message: "Product successfully created",
        product_id: result.insertId,
        image_url: key,
      });
    } catch (error) {
      console.error("Error creating product:", error.message);
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
  }
);

router.get("/products", async (req, res) => {
  console.log("Test");
  let connection;
  try {
    connection = await db.getConnection();

    const searchQuery = "SELECT * FROM product";
    const [products] = await connection.query(searchQuery);

    const signedUrlExpireSeconds = 60 * 5; // 5 minutes

    // Generate signed URLs for each product
    const productsWithSignedUrls = products.map((product) => {
      let signedUrl = null;
      try {
        signedUrl = s3.getSignedUrl("getObject", {
          Bucket: process.env.S3_BUCKET_NAME,
          Key: product.attachmentLink,
          Expires: signedUrlExpireSeconds,
        });
      } catch (error) {
        console.error(
          `Error generating signed URL for product ID ${product.id}:`,
          error.message
        );
      }
      return {
        ...product,
        signedImageUrl: signedUrl,
      };
    });

    return res.status(200).send({
      status: 200,
      is_error: false,
      products: productsWithSignedUrls,
    });
  } catch (error) {
    console.error("Error fetching products:", error.message);
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

router.get("/product/:id", async (req, res) => {
  const { id } = req.params;

  let connection;
  try {
    connection = await db.getConnection();

    const searchQuery = "SELECT * FROM product WHERE id = ?";
    const [products] = await connection.query(searchQuery, [id]);

    if (products.length === 0) {
      return res.status(404).send({
        status: 404,
        is_error: true,
        message: "Product not found",
      });
    }

    const product = products[0];
    const signedUrlExpireSeconds = 60 * 5; // 5 minutes

    // Generate a signed URL for the image
    const signedUrl = s3.getSignedUrl("getObject", {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: product.attachmentLink,
      Expires: signedUrlExpireSeconds,
    });

    product.signedImageUrl = signedUrl;

    return res.status(200).send({
      status: 200,
      is_error: false,
      product,
    });
  } catch (error) {
    console.error("Error fetching product:", error.message);
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

router.post(
  "/product/update/:id",
  authenticateJWT,
  upload.single("file"),
  async (req, res) => {
    const { id } = req.params;
    const { brand, model, price, totalPrice, title, description, features } =
      req.body;
    const file = req.file;

    let connection;
    try {
      connection = await db.getConnection();

      let updateQuery;
      let updateParams;

      if (file) {
        const key = `products/${Date.now()}_${file.originalname}`;
        const uploadParams = {
          Bucket: process.env.S3_BUCKET_NAME,
          Key: key,
          Body: file.buffer,
        };

        const uploadResult = await s3.upload(uploadParams).promise();

        updateQuery = `
                UPDATE product 
                SET brand = ?, model = ?, price = ?, totalPrice = ?, title = ?, description = ?, features = ?, attachmentLink = ?
                WHERE id = ?
            `;
        updateParams = [
          brand,
          model,
          price,
          totalPrice,
          title,
          description,
          features,
          key,
          id,
        ];
      } else {
        updateQuery = `
                UPDATE product 
                SET brand = ?, model = ?, price = ?, totalPrice = ?, title = ?, description = ?, features = ?
                WHERE id = ?
            `;
        updateParams = [
          brand,
          model,
          price,
          totalPrice,
          title,
          description,
          features,
          id,
        ];
      }

      const [result] = await connection.query(updateQuery, updateParams);

      if (result.affectedRows === 0) {
        return res.status(404).send({
          status: 404,
          is_error: true,
          message: "Product not found",
        });
      }

      return res.status(200).send({
        status: 200,
        is_error: false,
        message: "Product successfully updated",
      });
    } catch (error) {
      console.error("Error updating product:", error.message);
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
  }
);

router.delete("/product/delete/:id", authenticateJWT, async (req, res) => {
  const { id } = req.params;

  let connection;
  try {
    connection = await db.getConnection();

    const checkCartItemsQuery =
      "SELECT COUNT(*) as count FROM cart_items WHERE product_id = ?";
    const [cartItemsResult] = await connection.query(checkCartItemsQuery, [id]);

    if (cartItemsResult[0].count > 0) {
      return res.status(400).send({
        status: 400,
        is_error: true,
        message:
          "Cannot delete product, as it is associated with one or more cart items.",
      });
    }

    const deleteQuery = "DELETE FROM product WHERE id = ?";
    const [result] = await connection.query(deleteQuery, [id]);

    if (result.affectedRows === 0) {
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "Product not found",
      });
    }

    return res.status(200).send({
      status: 200,
      is_error: false,
      message: "Product successfully deleted",
    });
  } catch (error) {
    console.error("Error deleting product:", error.message);
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

router.post("/product/review/create", authenticateJWT, async (req, res) => {
  const { product_id, rating, comment } = req.body;
  const user_id = req.userId; // Assuming authenticateJWT middleware sets req.userId

  if (!product_id) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: "Product ID is required.",
    });
  }
  if (!rating) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: "Rating is required.",
    });
  }
  if (rating > 5) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: "Rating max limit is 5.",
    });
  }
  if (!comment) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: "Comment is required.",
    });
  }

  let connection;
  try {
    connection = await db.getConnection();

    const insertQuery = `
      INSERT INTO reviews (user_id, product_id, rating, comment, created_at)
      VALUES (?, ?, ?, ?, NOW())
    `;
    const [result] = await connection.query(insertQuery, [
      user_id,
      product_id,
      rating,
      comment,
    ]);

    return res.status(200).send({
      status: 200,
      is_error: false,
      message: "Review successfully created",
      review_id: result.insertId,
    });
  } catch (error) {
    console.error("Error creating review:", error.message);
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

router.get("/product/reviews/:product_id", async (req, res) => {
  const { product_id } = req.params; // Product ID

  let connection;
  try {
    connection = await db.getConnection();
    const searchQuery =
      "SELECT * FROM reviews r inner join users u on u.id = r.user_id WHERE product_id = ?";
    const [reviews] = await connection.query(searchQuery, [product_id]);

    return res.status(200).send({
      status: 200,
      is_error: false,
      reviews: reviews,
    });
  } catch (error) {
    console.error("Error fetching reviews:", error.message);
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
