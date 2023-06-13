const express = require('express'),
	{ isLoggedIn, isHotelAuthor } = require('../middlewares/index'),
	{ contactMail } = require('../middlewares/email');
const router = express.Router();
const Hotel = require('../models/hotel');

// ! cloud upload
const multer = require('multer');
const { storage } = require('../cloudinary/cloud_config');
const upload = multer({ storage });

// ! mapbox
const mbxGeocoding = require('@mapbox/mapbox-sdk/services/geocoding');
const geoCoder = mbxGeocoding({ accessToken: process.env.MAPBOX_TOKEN });

// ! STRIPE PAYMENT
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

router.get('/', async (req, res) => {
	try {
		const hotels = await Hotel.find().sort({ _id: -1 }).limit(3);
		res.render('landing', { hotels, page: 'Home' });
	} catch (error) {
		req.flash('error', 'error while fetching hotels, please try again later');
		console.log(error);
		res.redirect('/login');
	}
});

router.get('/contact', (req, res) => {
	res.render('contact', { page: 'Contact Us' });
});

router.post('/contact', async (req, res) => {
	try {
		await contactMail(req.body.contact);
		res.redirect('/contact');
	} catch (error) {
		req.flash('error', 'error while sending message, please try again later');
		console.log(error);
		res.redirect('/');
	}
});

router.get('/hotels', async (req, res) => {
	try {
		let options = {
			page: req.query.page || 1,
			limit: 5,
			sort: {
				_id: 'desc'
			}
		};
		let hotels = await Hotel.paginate({}, options);
		res.render('hotels/index', { hotels, page: 'Hotels' });
	} catch (error) {
		req.flash('error', 'error while fetching hotels, please try again later');
		console.log(error);
		res.redirect('/');
	}
});

router.get('/hotels/search', async (req, res) => {
	try {
		let { search } = req.query;
		if (!search) return res.redirect('/hotels');
		search = search.replace('%20', ' ');
		const regex = new RegExp(search.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'gi');
		const hotels = await Hotel.find({ name: regex });
		if (hotels.length < 1) return res.redirect('/hotels');
		res.render('hotels/search', { hotels, page: 'Search Hotels' });
	} catch (error) {
		req.flash('error', 'Something went wrong in the database');
		console.log(error);
		res.redirect('/');
	}
});

router.get('/hotels/new', isLoggedIn, (req, res) => {
	res.render('hotels/new', { page: 'Add Hotel' });
});

router.post('/hotels', isLoggedIn, upload.array('image'), async (req, res) => {
	try {
		let hotel = new Hotel(req.body.hotel);
		hotel.author = req.user._id;

		// * file upload using multer & cloudinary
		for (let file of req.files) {
			hotel.images.push({
				url: file.path,
				filename: file.filename
			});
		}
		// * geocoding using mapbox
		const geoData = await geoCoder
			.forwardGeocode({
				query: `${req.body.hotel.name}, ${req.body.hotel.address}`,
				limit: 1
			})
			.send();
		hotel.geometry = geoData.body.features[0].geometry;

		await hotel.save();
		req.flash('success', 'hotel created');
		res.redirect(`/hotels/${hotel._id}`);
	} catch (error) {
		req.flash('error', 'error while creating hotel, please try again later');
		console.log(error);
		res.redirect('/hotels');
	}
});

router.get('/hotels/:id', async (req, res) => {
	try {
		let hotel = await Hotel.findById(req.params.id)
			.populate({
				path: 'author'
			})
			.populate({
				path: 'reviews',
				populate: {
					path: 'author'
				}
			});
		let upvoteExists = null,
			downvoteExists = null;
		if (req.user) {
			upvoteExists = await Hotel.findOne({
				_id: req.params.id,
				upvotes: req.user._id
			});
			downvoteExists = await Hotel.findOne({
				_id: req.params.id,
				downvotes: req.user._id
			});
		}
		let coordinates = hotel.geometry.coordinates;
		res.render('hotels/show', { hotel, coordinates, upvoteExists, downvoteExists, page: 'Hotel' });
	} catch (error) {
		req.flash('error', 'error while fetching a hotel, please try again later');
		console.log(error);
		res.redirect('/hotels');
	}
});

router.get('/hotels/:id/edit', isLoggedIn, isHotelAuthor, async (req, res) => {
	try {
		let hotel = await Hotel.findById(req.params.id);
		res.render('hotels/edit', { hotel, page: 'Edit Hotel' });
	} catch (error) {
		req.flash('error', 'error while fetching a hotel, please try again later');
		console.log(error);
		res.redirect('/hotels');
	}
});

router.patch('/hotels/:id', isLoggedIn, isHotelAuthor, async (req, res) => {
	try {
		// * geocoding using mapbox
		const geoData = await geoCoder
			.forwardGeocode({
				query: `${req.body.hotel.name}, ${req.body.hotel.address}`,
				limit: 1
			})
			.send();
		req.body.hotel.geometry = geoData.body.features[0].geometry;
		await Hotel.findByIdAndUpdate(req.params.id, req.body.hotel);
		req.flash('success', 'update done');
		res.redirect(`/hotels/${req.params.id}`);
	} catch (error) {
		req.flash('error', 'error while updating a hotel, please try again later');
		console.log(error);
		res.redirect('/hotels');
	}
});

router.delete('/hotels/:id', isLoggedIn, isHotelAuthor, async (req, res) => {
	try {
		await Hotel.findByIdAndDelete(req.params.id);
		req.flash('success', 'delete done');
		res.redirect('/hotels');
	} catch (error) {
		req.flash('error', 'error while deleting a hotel, please try again later');
		console.log(error);
		res.redirect('/hotels');
	}
});

router.get('/hotels/:id/upvote', isLoggedIn, async (req, res) => {
	try {
		// check if user has already liked - remove the like
		const { id } = req.params;
		const hotel = await Hotel.findById(id);
		const upvoteExists = await Hotel.findOne({
			_id: id,
			upvotes: req.user._id
		});
		const downvoteExists = await Hotel.findOne({
			_id: id,
			downvotes: req.user._id
		});
		if (upvoteExists) {
			const hotel = await Hotel.findByIdAndUpdate(id, {
				$pull: { upvotes: req.user._id }
			});
			console.log('removed like');
			res.redirect(`/hotels/${req.params.id}`);
		} else if (downvoteExists) {
			// toggle user from downvotes array to upvotes array
			const hotel = await Hotel.findByIdAndUpdate(id, {
				$pull: { downvotes: req.user._id },
				$push: { upvotes: req.user._id }
			});
			console.log('removed your dislike and added a like');
			res.redirect(`/hotels/${req.params.id}`);
		} else {
			hotel.upvotes.push(req.user);
			await hotel.save();
			console.log('added like');
			res.redirect(`/hotels/${req.params.id}`);
		}
	} catch (error) {
		req.flash('error', 'error while adding a like, please try again later');
		console.log(error);
		res.redirect(`/hotels/${req.params.id}`);
	}
});
router.get('/hotels/:id/downvote', isLoggedIn, async (req, res) => {
	try {
		// check if user has already liked - remove the like
		const { id } = req.params;
		const hotel = await Hotel.findById(id);
		const upvoteExists = await Hotel.findOne({
			_id: id,
			upvotes: req.user._id
		});
		const downvoteExists = await Hotel.findOne({
			_id: id,
			downvotes: req.user._id
		});
		if (upvoteExists) {
			// toggle user from upvotes array to downvotes array
			const hotel = await Hotel.findByIdAndUpdate(id, {
				$pull: { upvotes: req.user._id },
				$push: { downvotes: req.user._id }
			});
			console.log('removed your like and added a dislike');
			res.redirect(`/hotels/${req.params.id}`);
		} else if (downvoteExists) {
			const hotel = await Hotel.findByIdAndUpdate(id, {
				$pull: { downvotes: req.user._id }
			});
			console.log('removed dislike');
			res.redirect(`/hotels/${req.params.id}`);
		} else {
			hotel.downvotes.push(req.user);
			await hotel.save();
			console.log('added dislike');
			res.redirect(`/hotels/${req.params.id}`);
		}
	} catch (error) {
		req.flash('error', 'error while adding a like, please try again later');
		console.log(error);
		res.redirect(`/hotels/${req.params.id}`);
	}
});
router.get('/hotels/:id/checkout/success', (req, res) => {
	const paymentInfo = req.session.paymentInfo;
	res.render('hotels/success.ejs', { details: paymentInfo, page: 'Success Hotel' });
});
router.get('/hotels/:id/checkout/cancel', (req, res) => {
	const paymentInfo = req.session.paymentInfo;
	res.render('hotels/failed.ejs', { details: paymentInfo, page: 'Failed Hotel' });
});
router.post('/hotels/:id/checkout', isLoggedIn, async (req, res) => {
	try {
		const hotel = await Hotel.findById(req.params.id);
		const total = parseInt(req.body.adults) + parseInt(req.body.children);
		if (total === 0) return res.redirect(`/hotels/${req.params.id}`);
		const rooms = Math.ceil(total / 3);
		// console.log(req.body);
		const diffTime = Math.abs(new Date(req.body.checkOutDate) - new Date(req.body.checkInDate));
		const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
		// console.log(total, rooms, diffTime, days);
		const session = await stripe.checkout.sessions.create({
			payment_method_types: [ 'card' ],
			customer_email: req.user.username,
			line_items: [
				{
					price_data: {
						currency: 'inr',
						product_data: {
							name: hotel.name,
							description: hotel.address,
							images: [ hotel.images[0].url ]
						},
						unit_amount: hotel.price * 100
					},
					quantity: rooms * days
				}
			],
			mode: 'payment',
			success_url: `${process.env.URL_SERV}hotels/${hotel._id}/checkout/success`,
			cancel_url: `${process.env.URL_SERV}hotels/${hotel._id}/checkout/cancel`
		});
		const paymentInfo = {
			...req.body,
			hotelName: hotel.name,
			hotelAddress: hotel.address,
			hotelPrice: hotel.price,
			userEmail: req.user.username,
			userName: req.user.name,
			rooms,
			days
		};
		req.session.paymentInfo = paymentInfo;
		res.redirect(session.url);
	} catch (error) {
		req.flash('error', 'error while processing the request, please try again later');
		console.log(error);
		res.redirect(`/hotels/${req.params.id}`);
	}
});
module.exports = router;
