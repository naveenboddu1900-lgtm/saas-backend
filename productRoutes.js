const router = require("express").Router();

const auth = require("../middleware/auth");

const {
createProduct,
getProducts
}
=
require("../controllers/productController");

router.post("/",auth,createProduct);
router.get("/",getProducts);

module.exports = router;