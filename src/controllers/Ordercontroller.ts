import { Request, Response, NextFunction } from "express";
import Order, { OrderStatus } from "../models/Order";
import Product from "../models/Product";
import { sendSuccess, sendError } from "../utils/response";
import { sendPushNotification } from "../utils/pushNotification";

// In your order controller, update the validation section:
const enrichAndValidateItems = async (
  rawItems: {
    productId?: string;
    product?: string;
    quantity: number;
  }[],
) => {
  const enriched = [];
  const errors: string[] = [];

  for (const raw of rawItems) {
    const productId = raw.productId || raw.product;

    if (!productId || !raw.quantity || raw.quantity < 1) {
      errors.push(`Invalid item: productId=${productId}`);
      continue;
    }

    const product = await Product.findById(productId).lean();
    if (!product) {
      errors.push(`Product not found: ${productId}`);
      continue;
    }
    if (!product.isActive) {
      errors.push(`Product is inactive: ${product.name}`);
      continue;
    }

    // ✅ Check minimum order quantity ONLY if limits are enforced
    if (
      product.enforceOrderLimits !== false &&
      product.minOrderQuantity &&
      raw.quantity < product.minOrderQuantity
    ) {
      errors.push(
        `Minimum order quantity for "${product.name}" is ${product.minOrderQuantity}. You tried to order ${raw.quantity}.`,
      );
      continue;
    }

    // ✅ Check maximum order quantity ONLY if limits are enforced
    if (
      product.enforceOrderLimits !== false &&
      product.maxOrderQuantity &&
      raw.quantity > product.maxOrderQuantity
    ) {
      errors.push(
        `Maximum order quantity for "${product.name}" is ${product.maxOrderQuantity}. You tried to order ${raw.quantity}.`,
      );
      continue;
    }

    // Check stock availability (always enforced)
    if (product.stockQuantity < raw.quantity) {
      errors.push(
        `Insufficient stock for "${product.name}". Available: ${product.stockQuantity}`,
      );
      continue;
    }

    // Get primary image from images array
    const primaryImage =
      product.images?.find((img: any) => img.isPrimary)?.url ??
      product.images?.[0]?.url ??
      undefined;

    // Convert specifications Map to plain object for storage
    const specs =
      product.specifications instanceof Map
        ? Object.fromEntries(product.specifications)
        : product.specifications || {};

    enriched.push({
      product: product._id,
      name: product.name,
      brand: product.brand,
      category: product.category,
      type: product.type,
      color: product.color,
      warranty: product.warranty,
      imageUrl: primaryImage,
      images: product.images || [],
      specifications: specs,
      compatibility: product.compatibility || [],
      dimensions: product.dimensions,
      weight: product.weight,
      material: product.material,
      sellingPrice: product.sellingPrice,
      originalPrice: product.originalPrice,
      quantity: raw.quantity,
      lineTotal: product.sellingPrice * raw.quantity,
    });
  }

  return { enriched, errors };
};

// ─── PLACE ORDER ──────────────────────────────────────────────────────────────
// POST /api/orders
export const placeOrder = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const customerId = (req as any).user?._id;
    if (!customerId) {
      sendError(res, "Unauthorized", undefined, 401);
      return;
    }

    const {
      items,
      deliveryAddress,
      couponCode,
      couponDiscount = 0,
      deliveryCharge = 0,
      platformFee = 0,
      gst = 0,
      deliveryTip = 0,
      paymentMethod = "upi",
      transactionId,
    } = req.body;

    // ── Basic validation ──
    if (!items || !Array.isArray(items) || items.length === 0) {
      sendError(res, "Order must contain at least one item");
      return;
    }

    if (!deliveryAddress) {
      sendError(res, "Delivery address is required");
      return;
    }

    const { contactName, addressLine1, city, state, pincode, phone } =
      deliveryAddress;
    if (
      !contactName ||
      !addressLine1 ||
      !city ||
      !state ||
      !pincode ||
      !phone
    ) {
      sendError(
        res,
        "Delivery address must include: contactName, addressLine1, city, state, pincode, phone",
      );
      return;
    }

    // ── Enrich items from DB (validate stock, prices) ──
    const { enriched, errors } = await enrichAndValidateItems(items);

    if (errors.length > 0) {
      res.status(400).json({
        success: false,
        message: "Some items failed validation",
        errors,
      });
      return;
    }

    // ── Compute totals server-side (don't trust client) ──
    const subtotal = enriched.reduce((sum, i) => sum + i.lineTotal, 0);

    const parsedCouponDiscount = Math.max(0, Number(couponDiscount) || 0);
    const parsedDeliveryCharge = Math.max(0, Number(deliveryCharge) || 0);
    const parsedPlatformFee = Math.max(0, Number(platformFee) || 0);
    const parsedGst = Math.max(0, Number(gst) || 0);
    const parsedDeliveryTip = Math.max(0, Number(deliveryTip) || 0);

    const totalAmount =
      subtotal -
      parsedCouponDiscount +
      parsedDeliveryCharge +
      parsedPlatformFee +
      parsedGst +
      parsedDeliveryTip;

    // ── Minimum order check ──
    const MIN_ORDER = 500;
    if (subtotal < MIN_ORDER) {
      sendError(
        res,
        `Minimum order value is ₹${MIN_ORDER}. Current subtotal is ₹${subtotal}.`,
        undefined,
        400,
      );
      return;
    }

    // ── Create order ──
    const order = new Order({
      customer: customerId,
      items: enriched,
      deliveryAddress: {
        contactName,
        addressLine1,
        addressLine2: deliveryAddress.addressLine2,
        city,
        state,
        pincode,
        phone,
      },
      subtotal,
      couponCode: couponCode || undefined,
      couponDiscount: parsedCouponDiscount,
      deliveryCharge: parsedDeliveryCharge,
      platformFee: parsedPlatformFee,
      gst: parsedGst,
      deliveryTip: parsedDeliveryTip,
      totalAmount,
      paymentMethod,
      paymentStatus: paymentMethod === "cod" ? "pending" : "paid",
      transactionId: transactionId || undefined,
      status: "confirmed",
      statusHistory: [
        { status: "pending", timestamp: new Date(), note: "Order placed" },
        {
          status: "confirmed",
          timestamp: new Date(),
          note: "Payment received",
        },
      ],
    });

    await order.save();

    // ── Decrement stock ──
    await Promise.all(
      enriched.map((item) =>
        Product.findByIdAndUpdate(item.product, {
          $inc: { stockQuantity: -item.quantity },
        }),
      ),
    );

    // Populate for response
    const populated = await Order.findById(order._id).populate(
      "customer",
      "phone profile.contactName",
    );

    sendSuccess(res, "Order placed successfully", populated, 201);
  } catch (error) {
    next(error);
  }
};

// ─── GET MY ORDERS (customer) ─────────────────────────────────────────────────
// GET /api/orders/my
export const getMyOrders = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const customerId = (req as any).user?._id;
    if (!customerId) {
      sendError(res, "Unauthorized", undefined, 401);
      return;
    }

    const { page = "1", limit = "10", status } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(50, parseInt(limit as string, 10));
    const skip = (pageNum - 1) * limitNum;

    const filter: Record<string, unknown> = { customer: customerId };
    if (status) filter.status = status;

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Order.countDocuments(filter),
    ]);

    sendSuccess(res, "Orders fetched successfully", {
      orders,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET SINGLE ORDER ─────────────────────────────────────────────────────────
// GET /api/orders/:id
export const getOrderById = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const customerId = (req as any).user?._id;

    const order = await Order.findById(req.params.id)
      .populate("customer", "phone profile.contactName")
      .lean();

    if (!order) {
      sendError(res, "Order not found", undefined, 404);
      return;
    }

    // Customers can only see their own orders; admins can see all
    const role = (req as any).user?.role;
    if (
      role !== "admin" &&
      order.customer.toString() !== customerId?.toString()
    ) {
      sendError(res, "Forbidden", undefined, 403);
      return;
    }

    sendSuccess(res, "Order fetched successfully", order);
  } catch (error) {
    next(error);
  }
};

// ─── CANCEL ORDER (customer) ──────────────────────────────────────────────────
// PATCH /api/orders/:id/cancel
export const cancelOrder = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const customerId = (req as any).user?._id;
    const { reason } = req.body;

    const order = await Order.findById(req.params.id);
    if (!order) {
      sendError(res, "Order not found", undefined, 404);
      return;
    }

    if (order.customer.toString() !== customerId?.toString()) {
      sendError(res, "Forbidden", undefined, 403);
      return;
    }

    const nonCancellable: OrderStatus[] = [
      "out_for_delivery",
      "delivered",
      "cancelled",
    ];
    if (nonCancellable.includes(order.status)) {
      sendError(
        res,
        `Cannot cancel an order that is "${order.status}"`,
        undefined,
        400,
      );
      return;
    }

    // Restore stock
    await Promise.all(
      order.items.map((item) =>
        Product.findByIdAndUpdate(item.product, {
          $inc: { stockQuantity: item.quantity },
        }),
      ),
    );

    order.status = "cancelled";
    order.cancelledAt = new Date();
    order.cancellationReason = reason || "Cancelled by customer";
    order.statusHistory.push({
      status: "cancelled",
      timestamp: new Date(),
      note: reason || "Cancelled by customer",
    });

    await order.save();
    sendSuccess(res, "Order cancelled successfully", order);
  } catch (error) {
    next(error);
  }
};

// ─── UPDATE ORDER STATUS (admin) ──────────────────────────────────────────────
// PATCH /api/orders/:id/status  — admin only
export const updateOrderStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { status, note } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) {
      sendError(res, "Order not found", undefined, 404);
      return;
    }

    const previousStatus = order.status;
    order.status = status;
    order.statusHistory.push({
      status,
      timestamp: new Date(),
      note: note || `Status updated to ${status}`,
    });

    await order.save();

    // ✅ Send push notification to customer
    const statusLabels: Record<string, string> = {
      confirmed: "Confirmed ✅",
      processing: "Processing 📦",
      out_for_delivery: "Out for Delivery 🚚",
      delivered: "Delivered 📬",
      cancelled: "Cancelled ❌",
    };

    const title = "Order Status Updated";

    // Get product names from order items
    const productNames = order.items.map((item) => item.name);
    let productNamesText = "";

    if (productNames.length === 1) {
      productNamesText = productNames[0];
    } else if (productNames.length === 2) {
      productNamesText = `${productNames[0]} and ${productNames[1]}`;
    } else if (productNames.length > 2) {
      productNamesText = `${productNames[0]} and ${productNames.length - 1} more item(s)`;
    }

    const body =
      productNames.length > 0
        ? `Your order containing ${productNamesText} is now ${statusLabels[status] || status}.`
        : `Your order is now ${statusLabels[status] || status}.`;

    await sendPushNotification(order.customer.toString(), title, body, {
      type: "order_status_update",
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      status: status,
      previousStatus: previousStatus,
      screen: "/(tabs)/myorders",
    });

    sendSuccess(res, "Order status updated", order);
  } catch (error) {
    next(error);
  }
};

// ─── GET ALL ORDERS (admin) ───────────────────────────────────────────────────
// GET /api/orders  — admin only
export const getAllOrders = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      page = "1",
      limit = "20",
      status,
      customerId,
      from,
      to,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, parseInt(limit as string, 10));
    const skip = (pageNum - 1) * limitNum;

    // ✅ Filter out orders with deleted customers by default
    const filter: Record<string, unknown> = {
      customer: { $exists: true, $ne: null },
    };

    if (status) filter.status = status;

    // If specific customer is requested, override the default filter
    if (customerId) {
      filter.customer = customerId;
    }

    if (from || to) {
      filter.createdAt = {
        ...(from ? { $gte: new Date(from as string) } : {}),
        ...(to ? { $lte: new Date(to as string) } : {}),
      };
    }

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate(
          "customer",
          "phone profile.contactName profile.addressLine1 profile.addressLine2 profile.city profile.state profile.pincode profile.gstNumber",
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Order.countDocuments(filter),
    ]);

    sendSuccess(res, "Orders fetched successfully", {
      orders,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};
