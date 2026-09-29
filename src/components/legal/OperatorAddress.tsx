// The provider named by the imprint (§ 5 DDG) and the controller named by the privacy policy
// (Art. 13 GDPR), as on shiftbloom.studio. Their details live here and nowhere else. It must be
// a person or legal entity: an Open Collective is neither, and its fiscal host doesn't run the
// site. The address decides the supervisory authority named in the privacy policy.
export const operator = {
    name: "Fabian Zimber",
    business: "shiftbloom studio",
    street: "Up de Worth 6a",
    city: "22927 Großhansdorf",
    email: "fabian@shiftbloom.studio",
    phone: "+49 163 8552 708",
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
