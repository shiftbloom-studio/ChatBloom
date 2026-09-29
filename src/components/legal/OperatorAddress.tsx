// The provider named by the imprint (§ 5 DDG) and the controller named by the privacy policy
// (Art. 13 GDPR). Their details live here and nowhere else.
// TODO(Fabian): a street address where you can be served (no P.O. box) and a phone number.
export const operator = {
    name: "Fabian Zimber",
    business: "shiftbloom studio",
    street: "[Street and number]",
    city: "[Postcode] Hamburg",
    email: "hello@shiftbloom.studio",
    phone: "[Phone number]",
    /** USt-IdNr. (§ 27a UStG); the imprint must show it once one has been issued. */
    vatId: undefined as string | undefined,
};

export default function OperatorAddress(props: { lang: "en" | "de" }) {
    return (
        <address>
            {operator.name}
            <br />
            {operator.business}
            <br />
            {operator.street}
            <br />
            {operator.city}
            <br />
            {props.lang === "de" ? "Deutschland" : "Germany"}
        </address>
    );
}
