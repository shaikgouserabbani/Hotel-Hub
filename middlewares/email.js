const nodemailer = require('nodemailer');
const Mailgen = require('mailgen');
require('dotenv').config();

let transporter = nodemailer.createTransport({
    service:"Gmail",
    secure: true,
    auth:{
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASSWORD
    }
});

const contactMail = async(contact) => {
    try{
        let mailGenerator = new Mailgen({
            theme:"default",
            product:{
                name: "StaySense",
                link: `${process.env.URL_SERV}`
            }
        });
        
        const email = {
            body:{
                intro:[
                    'Someone sent you a message',
                    `Email: ${contact.email}`,
                    `Name: ${contact.name}`,
                ],
                outro: [ `${contact.message}`]
            }
        };

        let emailBody = mailGenerator.generate(email);
        let message = {
            from: process.env.EMAIL,
            to:process.env.EMAIL, 
            subject:"StaySense - Contact",
            html:emailBody
        }
        await transporter.sendMail(message);
        return true;
    } catch(error){
        if(error) throw error;
    }
}

module.exports = {
    contactMail
}